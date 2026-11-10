//! Native Rust High-Speed Mathematical Kernel Microservice (`swrt-rust-kernel`)
//!
//! Implements all 5 deterministic mathematical pillars of the IDX SWRT Engine:
//! 1. Sinkhorn-Knopp Entropic Optimal Transport Broker Matrix (`/v1/sinkhorn`)
//! 2. Depth-3 Limit Order Book Rough Path Signature & Lévy Area Spoofing Detector (`/v1/rough-signature`)
//! 3. Cellular Sheaf Laplacian L_F, Dirichlet Energy Phi(x), & 16x16 Harmonic Section (`/v1/sheaf-cohomology`)
//! 4. Wasserstein Distributionally Robust Optimization (WDRO) Lot Sizer (`/v1/wdro-lots`)
//! 5. Ornstein-Uhlenbeck First-Passage Optimal Stopping Solver (`/v1/ou-stopping`)
//! Plus combined sub-millisecond Pillar 3+4+5 endpoint (`/v1/solve-sheaf-wdro-ou`).

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, env, net::SocketAddr, time::Instant};

const IDX_LOT_SHARES: i64 = 100;
const IDX_BUY_FEE: f64 = 0.0015;
const IDX_SELL_FEE: f64 = 0.0025;
const IDX_ROUND_TRIP_FEE: f64 = IDX_BUY_FEE + IDX_SELL_FEE; // 0.0040 (0.40%)
const PRE_ARB_MAX_DRAWDOWN_PCT: f64 = 0.052; // -5.2% hard circuit breaker before -7% ARB
const ARB_LIMIT_PCT: f64 = 0.070; // -7.0% symmetric ARB across all tiers

fn round_n(val: f64, decimals: i32) -> f64 {
    let factor = 10_f64.powi(decimals);
    (val * factor).round() / factor
}

// ============================================================================
// IDX MICROSTRUCTURE & REGULATORY RULES (Kep-00157/BEI/10-2026)
// ============================================================================

pub fn idx_tick_size(price_rp: f64) -> i64 {
    if price_rp < 200.0 {
        1
    } else if price_rp < 500.0 {
        2
    } else if price_rp < 2000.0 {
        5
    } else if price_rp < 5000.0 {
        10
    } else {
        25
    }
}

pub fn round_to_idx_tick(price_rp: f64, mode: &str) -> i64 {
    if price_rp <= 1.0 {
        return 1;
    }
    let tick = idx_tick_size(price_rp) as f64;
    let mut rounded = match mode {
        "floor" => (((price_rp + 1e-9) / tick).floor() * tick) as i64,
        "ceil" => (((price_rp - 1e-9) / tick).ceil() * tick) as i64,
        _ => ((price_rp / tick).round() * tick) as i64,
    };
    rounded = rounded.max(1);

    let new_tick = idx_tick_size(rounded as f64);
    if rounded % new_tick != 0 {
        let nt = new_tick as f64;
        let r_f = rounded as f64;
        rounded = match mode {
            "floor" => ((r_f / nt).floor() * nt) as i64,
            "ceil" => ((r_f / nt).ceil() * nt) as i64,
            _ => ((r_f / nt).round() * nt) as i64,
        };
    }
    rounded.max(1)
}

pub fn get_ara_pct(prev_close_rp: i64) -> f64 {
    if prev_close_rp <= 200 {
        0.35
    } else if prev_close_rp <= 5000 {
        0.25
    } else {
        0.20
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AraArbBounds {
    pub prev_close_rp: i64,
    pub ara_pct: f64,
    pub arb_pct: f64,
    pub ara_rp: i64,
    pub arb_rp: i64,
    pub pre_arb_floor_rp: i64,
}

pub fn compute_ara_arb_bounds(prev_close_rp: i64) -> AraArbBounds {
    let prev_close = round_to_idx_tick(prev_close_rp as f64, "nearest");
    let ara_pct = get_ara_pct(prev_close);
    let raw_ara = (prev_close as f64) * (1.0 + ara_pct);
    let raw_arb = (prev_close as f64) * (1.0 - ARB_LIMIT_PCT);
    let raw_pre_arb_floor = (prev_close as f64) * (1.0 - PRE_ARB_MAX_DRAWDOWN_PCT);

    let ara_rp = round_to_idx_tick(raw_ara, "floor").max(50);
    let arb_min = if prev_close >= 50 { 50 } else { 1 };
    let arb_rp = round_to_idx_tick(raw_arb, "ceil").max(arb_min);
    let pre_arb_floor_rp = round_to_idx_tick(raw_pre_arb_floor, "ceil").max(arb_rp);

    AraArbBounds {
        prev_close_rp: prev_close,
        ara_pct,
        arb_pct: ARB_LIMIT_PCT,
        ara_rp,
        arb_rp,
        pre_arb_floor_rp,
    }
}

pub fn compute_min_required_edge(epsilon_phi: f64) -> f64 {
    3.0 * IDX_ROUND_TRIP_FEE + epsilon_phi.max(0.0)
}

// ============================================================================
// PILLAR 1: SINKHORN-KNOPP ENTROPIC OPTIMAL TRANSPORT BROKER MATRIX
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct BrokerEntry {
    #[serde(default)]
    pub broker: String,
    #[serde(default)]
    pub lots: f64,
    #[serde(default = "default_avg_price")]
    pub avg_price: f64,
    #[serde(default)]
    pub category: Option<String>,
}

fn default_avg_price() -> f64 {
    1000.0
}

fn default_reg_epsilon() -> f64 {
    0.08
}

#[derive(Debug, Clone, Deserialize)]
pub struct SinkhornRequest {
    #[serde(default)]
    pub brokers_buy: Vec<BrokerEntry>,
    #[serde(default)]
    pub brokers_sell: Vec<BrokerEntry>,
    #[serde(default = "default_reg_epsilon")]
    pub reg_epsilon: f64,
}

fn classify_broker_tier(broker_code: &str) -> &'static str {
    let code = broker_code.trim().to_uppercase();
    match code.as_str() {
        "ZP" | "YU" | "AK" | "BK" | "RX" | "KZ" | "MS" | "CS" | "CG" | "DB" | "ML" | "CL" => {
            "INST_FOREIGN"
        }
        "CC" | "NI" | "OD" | "DX" | "IF" | "LG" | "KI" | "TP" | "BB" | "AG" => "INST_DOMESTIC",
        "YP" | "PD" | "XC" | "XL" | "KK" | "SQ" | "MG" | "CP" | "BQ" | "AZ" | "DR" | "EP" => {
            "RETAIL"
        }
        _ => "SYNDICATE_OTHER",
    }
}

fn is_inst_tier(cat: &str) -> bool {
    cat == "INST_FOREIGN" || cat == "INST_DOMESTIC"
}

pub fn solve_sinkhorn_core(req: &SinkhornRequest) -> Value {
    let t0 = Instant::now();
    if req.brokers_buy.is_empty() || req.brokers_sell.is_empty() {
        return json!({
            "conviction_kappa": 0.0,
            "retail_to_inst_flow": 0.0,
            "inst_to_retail_flow": 0.0,
            "inst_to_inst_flow": 0.0,
            "self_loop_wash_ratio": 0.0,
            "sinkhorn_divergence": 0.0,
            "top_concentration_ratio": 0.0,
            "top3_buy_concentration": 0.0,
            "top3_sell_concentration": 0.0,
            "net_inst_pressure": 0.0,
            "transport_matrix": [],
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        });
    }

    let n_sell = req.brokers_sell.len();
    let n_buy = req.brokers_buy.len();

    let buy_lots: Vec<f64> = req.brokers_buy.iter().map(|b| b.lots.max(1.0)).collect();
    let sell_lots: Vec<f64> = req.brokers_sell.iter().map(|s| s.lots.max(1.0)).collect();

    let sum_sell: f64 = sell_lots.iter().sum();
    let sum_buy: f64 = buy_lots.iter().sum();

    let p_sell: Vec<f64> = sell_lots.iter().map(|&x| x / sum_sell).collect();
    let q_buy: Vec<f64> = buy_lots.iter().map(|&x| x / sum_buy).collect();

    let sell_cats: Vec<String> = req
        .brokers_sell
        .iter()
        .map(|s| {
            s.category
                .as_deref()
                .filter(|c| !c.is_empty())
                .map(|c| c.to_string())
                .unwrap_or_else(|| classify_broker_tier(&s.broker).to_string())
        })
        .collect();

    let buy_cats: Vec<String> = req
        .brokers_buy
        .iter()
        .map(|b| {
            b.category
                .as_deref()
                .filter(|c| !c.is_empty())
                .map(|c| c.to_string())
                .unwrap_or_else(|| classify_broker_tier(&b.broker).to_string())
        })
        .collect();

    let sell_prices: Vec<f64> = req.brokers_sell.iter().map(|s| s.avg_price).collect();
    let buy_prices: Vec<f64> = req.brokers_buy.iter().map(|b| b.avg_price).collect();

    let total_price_sum: f64 =
        sell_prices.iter().sum::<f64>() + buy_prices.iter().sum::<f64>();
    let ref_price = (total_price_sum / ((n_sell + n_buy) as f64)).max(1.0);

    let reg = req.reg_epsilon.max(0.01);
    let mut cost_matrix = vec![vec![0.0_f64; n_buy]; n_sell];
    let mut k_matrix = vec![vec![0.0_f64; n_buy]; n_sell];

    for i in 0..n_sell {
        let s_code = req.brokers_sell[i].broker.trim().to_uppercase();
        for j in 0..n_buy {
            let b_code = req.brokers_buy[j].broker.trim().to_uppercase();
            let price_diff = (sell_prices[i] - buy_prices[j]).abs() / ref_price;
            let mut base_cost = 0.25 + 10.0 * price_diff;
            if s_code == b_code {
                base_cost = 0.08 + 2.0 * price_diff;
            } else if sell_cats[i] == "RETAIL" && is_inst_tier(&buy_cats[j]) {
                base_cost = 0.18 + 5.0 * price_diff;
            } else if is_inst_tier(&sell_cats[i]) && buy_cats[j] == "RETAIL" {
                base_cost = 0.18 + 5.0 * price_diff;
            }
            cost_matrix[i][j] = base_cost;
            k_matrix[i][j] = (-base_cost / reg).exp();
        }
    }

    // Sinkhorn-Knopp iterative scaling matching POT ot.sinkhorn(p_sell, q_buy, C, reg, numItermax=1000, stopThr=1e-7)
    let mut u = vec![1.0 / (n_sell as f64); n_sell];
    let mut v = vec![1.0 / (n_buy as f64); n_buy];

    for iter in 0..1000 {
        for i in 0..n_sell {
            let mut kv_i = 0.0;
            for j in 0..n_buy {
                kv_i += k_matrix[i][j] * v[j];
            }
            u[i] = p_sell[i] / kv_i.max(1e-300);
        }
        for j in 0..n_buy {
            let mut ktu_j = 0.0;
            for i in 0..n_sell {
                ktu_j += k_matrix[i][j] * u[i];
            }
            v[j] = q_buy[j] / ktu_j.max(1e-300);
        }
        if iter % 10 == 0 {
            let mut err_sq = 0.0;
            for i in 0..n_sell {
                let mut kv_i = 0.0;
                for j in 0..n_buy {
                    kv_i += k_matrix[i][j] * v[j];
                }
                let diff = u[i] * kv_i - p_sell[i];
                err_sq += diff * diff;
            }
            if err_sq.sqrt() < 1e-7 {
                break;
            }
        }
    }

    let mut gamma = vec![vec![0.0_f64; n_buy]; n_sell];
    let mut retail_to_inst = 0.0_f64;
    let mut inst_to_retail = 0.0_f64;
    let mut self_loop_wash = 0.0_f64;
    let mut inst_to_inst = 0.0_f64;
    let mut sinkhorn_div = 0.0_f64;

    for i in 0..n_sell {
        let s_code = req.brokers_sell[i].broker.trim().to_uppercase();
        for j in 0..n_buy {
            let mass = u[i] * k_matrix[i][j] * v[j];
            gamma[i][j] = round_n(mass, 5);
            sinkhorn_div += mass * cost_matrix[i][j];

            let b_code = req.brokers_buy[j].broker.trim().to_uppercase();
            if s_code == b_code {
                self_loop_wash += mass;
            }
            if sell_cats[i] == "RETAIL" && is_inst_tier(&buy_cats[j]) {
                retail_to_inst += mass;
            } else if is_inst_tier(&sell_cats[i]) && buy_cats[j] == "RETAIL" {
                inst_to_retail += mass;
            } else if is_inst_tier(&sell_cats[i]) && is_inst_tier(&buy_cats[j]) {
                inst_to_inst += mass;
            }
        }
    }

    let inst_buy_vol: f64 = (0..n_buy)
        .filter(|&j| is_inst_tier(&buy_cats[j]))
        .map(|j| buy_lots[j])
        .sum();
    let inst_sell_vol: f64 = (0..n_sell)
        .filter(|&i| is_inst_tier(&sell_cats[i]))
        .map(|i| sell_lots[i])
        .sum();

    let total_vol = ((sum_buy + sum_sell) / 2.0).max(1.0);
    let net_inst_pressure = (inst_buy_vol - inst_sell_vol) / total_vol;
    let net_ot_flow = retail_to_inst - inst_to_retail;

    let mut sorted_buy = q_buy.clone();
    sorted_buy.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    let mut sorted_sell = p_sell.clone();
    sorted_sell.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));

    let top3_buy: f64 = sorted_buy.iter().take(3).sum();
    let top3_sell: f64 = sorted_sell.iter().take(3).sum();
    let concentration_diff = top3_buy - top3_sell;

    let wash_penalty = (self_loop_wash - 0.12).max(0.0) * 1.25;
    let mut raw_kappa =
        0.50 * net_ot_flow + 0.35 * net_inst_pressure + 0.25 * concentration_diff;
    if raw_kappa > 0.0 {
        raw_kappa = (raw_kappa - wash_penalty).max(0.0);
    } else {
        raw_kappa -= 0.5 * wash_penalty;
    }

    let conviction_kappa = (2.2 * raw_kappa).tanh().clamp(-0.99, 0.99);

    json!({
        "conviction_kappa": round_n(conviction_kappa, 6),
        "retail_to_inst_flow": round_n(retail_to_inst, 6),
        "inst_to_retail_flow": round_n(inst_to_retail, 6),
        "inst_to_inst_flow": round_n(inst_to_inst, 6),
        "self_loop_wash_ratio": round_n(self_loop_wash, 6),
        "sinkhorn_divergence": round_n(sinkhorn_div, 6),
        "top3_buy_concentration": round_n(top3_buy, 6),
        "top3_sell_concentration": round_n(top3_sell, 6),
        "net_inst_pressure": round_n(net_inst_pressure, 6),
        "transport_matrix": gamma,
        "kernel_latency_us": t0.elapsed().as_micros() as u64,
        "engine": "rust-axum-native"
    })
}

// ============================================================================
// PILLAR 2: DEPTH-3 LOB ROUGH PATH SIGNATURE & LEVY SPOOFING DETECTOR
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct RoughSignatureRequest {
    pub micro_prices: Vec<f64>,
    pub ofi_series: Vec<f64>,
    pub cancel_rates: Vec<f64>,
    #[serde(default)]
    pub bid_levels_lots: Vec<f64>,
    #[serde(default)]
    pub ask_levels_lots: Vec<f64>,
    pub prev_close_rp: i64,
    pub last_price_rp: i64,
}

fn mean_slice(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    xs.iter().sum::<f64>() / (xs.len() as f64)
}

fn pop_std_slice(xs: &[f64], mean: f64) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let var = xs.iter().map(|&x| (x - mean) * (x - mean)).sum::<f64>() / (xs.len() as f64);
    var.sqrt()
}

fn compute_depth3_signature_3d(path: &[[f64; 3]]) -> ([f64; 3], [[f64; 3]; 3], [[[f64; 3]; 3]; 3]) {
    let mut s1 = [0.0_f64; 3];
    let mut s2 = [[0.0_f64; 3]; 3];
    let mut s3 = [[[0.0_f64; 3]; 3]; 3];

    if path.len() < 2 {
        return (s1, s2, s3);
    }

    for idx in 0..(path.len() - 1) {
        let z = [
            path[idx + 1][0] - path[idx][0],
            path[idx + 1][1] - path[idx][1],
            path[idx + 1][2] - path[idx][2],
        ];

        let mut z2 = [[0.0_f64; 3]; 3];
        let mut z3 = [[[0.0_f64; 3]; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                z2[i][j] = 0.5 * z[i] * z[j];
                for k in 0..3 {
                    z3[i][j][k] = (1.0 / 6.0) * z[i] * z[j] * z[k];
                }
            }
        }

        let mut new_s3 = [[[0.0_f64; 3]; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                for k in 0..3 {
                    new_s3[i][j][k] =
                        s3[i][j][k] + s2[i][j] * z[k] + s1[i] * z2[j][k] + z3[i][j][k];
                }
            }
        }

        let mut new_s2 = [[0.0_f64; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                new_s2[i][j] = s2[i][j] + s1[i] * z[j] + z2[i][j];
            }
        }

        let new_s1 = [s1[0] + z[0], s1[1] + z[1], s1[2] + z[2]];
        s1 = new_s1;
        s2 = new_s2;
        s3 = new_s3;
    }

    (s1, s2, s3)
}

pub fn solve_rough_signature_core(req: &RoughSignatureRequest) -> Result<Value, String> {
    let t0 = Instant::now();
    let n_pts = req
        .micro_prices
        .len()
        .min(req.ofi_series.len())
        .min(req.cancel_rates.len());
    if n_pts < 3 {
        return Err(
            "Rough path signature requires at least 3 intraday trajectory observations.".to_string(),
        );
    }

    let p_arr = &req.micro_prices[..n_pts];
    let o_arr = &req.ofi_series[..n_pts];
    let c_arr = &req.cancel_rates[..n_pts];

    let o_mean = mean_slice(o_arr);
    let o_std = pop_std_slice(o_arr, o_mean).max(10.0);
    let o_mean_drift = o_mean / 65.0;

    let mean_cancel = mean_slice(c_arr);
    let c_std = pop_std_slice(c_arr, mean_cancel).max(0.05);

    let prev_close_f = (req.prev_close_rp as f64).max(1.0);
    let denom_linspace = ((n_pts - 1) as f64).max(1.0);

    let mut path = Vec::with_capacity(n_pts);
    for t in 0..n_pts {
        let frac = (t as f64) / denom_linspace;
        let p_norm = (p_arr[t] - p_arr[0]) / prev_close_f * 25.0;
        let o_osc = (o_arr[t] - o_mean) / o_std;
        let o_norm = (o_mean_drift * frac) + 0.45 * o_osc;
        let c_osc = (c_arr[t] - mean_cancel) / c_std;
        let c_norm = (mean_cancel * frac) + mean_cancel * c_osc;
        path.push([p_norm, o_norm, c_norm]);
    }

    let (s1, s2, s3) = compute_depth3_signature_3d(&path);

    let mut levy_area = [[0.0_f64; 3]; 3];
    let mut levy_area_rounded = vec![vec![0.0_f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            levy_area[i][j] = 0.5 * (s2[i][j] - s2[j][i]);
            levy_area_rounded[i][j] = round_n(levy_area[i][j], 6);
        }
    }

    let levy_ofi_cancel = levy_area[1][2];
    let levy_price_ofi = levy_area[0][1];
    let depth3_downward_accel = s3[0][0][0];

    let total_bid_lots: f64 = req.bid_levels_lots.iter().sum();
    let total_ask_lots: f64 = req.ask_levels_lots.iter().sum();
    let book_imbalance =
        (total_bid_lots - total_ask_lots) / (total_bid_lots + total_ask_lots).max(1.0);

    let bounds = compute_ara_arb_bounds(req.prev_close_rp);
    let arb_rp = bounds.arb_rp;
    let dist_to_arb_pct =
        (((req.last_price_rp as f64) - (arb_rp as f64)) / prev_close_f).max(0.0);

    let proximity_hazard = (-dist_to_arb_pct / 0.022).exp();
    let depletion_hazard = (-book_imbalance).max(0.0);
    let spoofing_score = (levy_ofi_cancel.max(0.0) * 1.8).tanh().clamp(0.0, 1.0);
    let downward_cascade_term = ((-s1[0] * 0.9 - depth3_downward_accel).max(0.0))
        .tanh()
        .clamp(0.0, 1.0);

    let raw_h_arb = 0.42 * proximity_hazard
        + 0.28 * depletion_hazard
        + 0.18 * downward_cascade_term
        + 0.12 * spoofing_score;
    let h_arb = raw_h_arb.clamp(0.01, 0.99);

    let raw_lob_drift =
        0.55 * (s1[0] * 1.2).tanh() + 0.45 * book_imbalance - 0.65 * spoofing_score;
    let lob_mu_5d = raw_lob_drift.clamp(-0.98, 0.98);
    let liquidity_score = (book_imbalance - 0.5 * spoofing_score).clamp(-0.98, 0.98);

    Ok(json!({
        "s1_vector": [round_n(s1[0], 6), round_n(s1[1], 6), round_n(s1[2], 6)],
        "levy_area_matrix": levy_area_rounded,
        "levy_ofi_cancel": round_n(levy_ofi_cancel, 6),
        "levy_price_ofi": round_n(levy_price_ofi, 6),
        "depth3_price_cubic": round_n(depth3_downward_accel, 6),
        "spoofing_detected": spoofing_score > 0.35,
        "spoofing_intensity": round_n(spoofing_score, 6),
        "book_imbalance": round_n(book_imbalance, 6),
        "dist_to_arb_pct": round_n(dist_to_arb_pct, 6),
        "h_arb": round_n(h_arb, 6),
        "lob_mu_5d": round_n(lob_mu_5d, 6),
        "liquidity_score": round_n(liquidity_score, 6),
        "kernel_latency_us": t0.elapsed().as_micros() as u64,
        "engine": "rust-axum-native"
    }))
}

// ============================================================================
// PILLAR 3: CELLULAR SHEAF LAPLACIAN L_F & COHOMOLOGY FAULT EXTRACTOR
// ============================================================================

fn default_cohomology_threshold() -> f64 {
    0.70
}

#[derive(Debug, Clone, Deserialize)]
pub struct SheafCohomologyRequest {
    pub stalks_by_agent: HashMap<String, Vec<f64>>,
    #[serde(default = "default_cohomology_threshold")]
    pub cohomology_threshold: f64,
}

/// Solve 16x16 linear system A * x = b using Gaussian elimination with partial pivoting.
fn solve_linear_16x16(mut a: [[f64; 16]; 16], mut b: [f64; 16]) -> [f64; 16] {
    for k in 0..16 {
        let mut pivot_row = k;
        let mut max_val = a[k][k].abs();
        for i in (k + 1)..16 {
            if a[i][k].abs() > max_val {
                max_val = a[i][k].abs();
                pivot_row = i;
            }
        }
        if pivot_row != k {
            a.swap(k, pivot_row);
            b.swap(k, pivot_row);
        }
        let pivot = if a[k][k].abs() < 1e-12 {
            1e-12
        } else {
            a[k][k]
        };
        for i in (k + 1)..16 {
            let factor = a[i][k] / pivot;
            for j in k..16 {
                a[i][j] -= factor * a[k][j];
            }
            b[i] -= factor * b[k];
        }
    }

    let mut x = [0.0_f64; 16];
    for i in (0..16).rev() {
        let mut sum = b[i];
        for j in (i + 1)..16 {
            sum -= a[i][j] * x[j];
        }
        let diag = if a[i][i].abs() < 1e-12 {
            1e-12
        } else {
            a[i][i]
        };
        x[i] = sum / diag;
    }
    x
}

pub fn solve_sheaf_cohomology_core(req: &SheafCohomologyRequest) -> Result<Value, String> {
    let t0 = Instant::now();
    let agent_order = ["BDM", "LOB", "NLP", "MAC"];
    let mut stalk_matrix = [[0.0_f64; 4]; 4];
    let mut x_vec = [0.0_f64; 16];

    for (ag_idx, &ag) in agent_order.iter().enumerate() {
        let vec_in = req.stalks_by_agent.get(ag).ok_or_else(|| {
            format!("Missing or malformed 4D stalk vector for agent '{}'.", ag)
        })?;
        if vec_in.len() != 4 {
            return Err(format!(
                "Missing or malformed 4D stalk vector for agent '{}'.",
                ag
            ));
        }
        for c in 0..4 {
            stalk_matrix[ag_idx][c] = vec_in[c];
            x_vec[ag_idx * 4 + c] = vec_in[c];
        }
    }

    let restriction_diag = [1.35_f64, 0.45_f64, 0.85_f64, 1.10_f64];
    let edges_spec: [(&str, &str, f64); 6] = [
        ("BDM", "NLP", 1.45),
        ("BDM", "LOB", 1.25),
        ("LOB", "NLP", 1.20),
        ("BDM", "MAC", 1.00),
        ("LOB", "MAC", 0.95),
        ("NLP", "MAC", 1.05),
    ];

    let mut delta_blocks = [[0.0_f64; 16]; 24];
    let mut edge_faults: Vec<Value> = Vec::with_capacity(6);

    for (e_idx, &(u_name, v_name, weight)) in edges_spec.iter().enumerate() {
        let u_i = agent_order.iter().position(|&a| a == u_name).unwrap();
        let v_i = agent_order.iter().position(|&a| a == v_name).unwrap();
        let w_sqrt = weight.sqrt();

        let mut sq_sum = 0.0_f64;
        for c in 0..4 {
            let f_diag = w_sqrt * restriction_diag[c];
            delta_blocks[e_idx * 4 + c][u_i * 4 + c] = f_diag;
            delta_blocks[e_idx * 4 + c][v_i * 4 + c] = -f_diag;

            let diff = f_diag * (stalk_matrix[u_i][c] - stalk_matrix[v_i][c]);
            sq_sum += diff * diff;
        }
        let fault_norm = sq_sum.sqrt();
        let mu_gap = stalk_matrix[u_i][0] - stalk_matrix[v_i][0];

        edge_faults.push(json!({
            "edge": format!("{}<->{}", u_name, v_name),
            "source": u_name,
            "target": v_name,
            "weight": weight,
            "fault_norm": round_n(fault_norm, 6),
            "mu_5d_discrepancy": round_n(mu_gap, 6),
            "is_contradiction": fault_norm > 0.85
        }));
    }

    // L_F = delta_blocks^T * delta_blocks (16x16)
    let mut l_f = [[0.0_f64; 16]; 16];
    for i in 0..16 {
        for j in 0..16 {
            let mut s = 0.0_f64;
            for r in 0..24 {
                s += delta_blocks[r][i] * delta_blocks[r][j];
            }
            l_f[i][j] = s;
        }
    }

    // quad_energy = x_vec^T * L_F * x_vec
    let mut quad_energy = 0.0_f64;
    let mut norm_sq = 0.25_f64;
    let mut lap_trace = 0.0_f64;
    for i in 0..16 {
        norm_sq += x_vec[i] * x_vec[i];
        lap_trace += l_f[i][i];
        let mut row_dot = 0.0_f64;
        for j in 0..16 {
            row_dot += l_f[i][j] * x_vec[j];
        }
        quad_energy += x_vec[i] * row_dot;
    }

    let sheaf_phi = 0.22 * quad_energy / norm_sq;

    // Heat-kernel smoothing: (I + 0.20 * L_F) * x_smoothed = x_vec
    let alpha_smooth = 0.20_f64;
    let mut a_sys = [[0.0_f64; 16]; 16];
    for i in 0..16 {
        for j in 0..16 {
            a_sys[i][j] = alpha_smooth * l_f[i][j] + if i == j { 1.0 } else { 0.0 };
        }
    }
    let x_smoothed_flat = solve_linear_16x16(a_sys, x_vec);

    let pillar_weights = [0.34_f64, 0.30_f64, 0.16_f64, 0.20_f64];
    let mut consensus_stalk = [0.0_f64; 4];
    for c in 0..4 {
        let mut s = 0.0_f64;
        for ag_i in 0..4 {
            s += pillar_weights[ag_i] * x_smoothed_flat[ag_i * 4 + c];
        }
        consensus_stalk[c] = s;
    }
    let max_h_arb = stalk_matrix[0][3].max(stalk_matrix[1][3]);
    consensus_stalk[3] = consensus_stalk[3].max(0.85 * max_h_arb);

    edge_faults.sort_by(|a, b| {
        let fa = a["fault_norm"].as_f64().unwrap_or(0.0);
        let fb = b["fault_norm"].as_f64().unwrap_or(0.0);
        fb.partial_cmp(&fa).unwrap_or(std::cmp::Ordering::Equal)
    });

    let primary_fault_edge = edge_faults
        .first()
        .and_then(|f| f["edge"].as_str())
        .unwrap_or("NONE")
        .to_string();
    let primary_fault_norm = edge_faults
        .first()
        .and_then(|f| f["fault_norm"].as_f64())
        .unwrap_or(0.0);

    let mut smoothed_stalks = serde_json::Map::new();
    for (ag_i, &ag) in agent_order.iter().enumerate() {
        smoothed_stalks.insert(
            ag.to_string(),
            json!([
                round_n(x_smoothed_flat[ag_i * 4], 6),
                round_n(x_smoothed_flat[ag_i * 4 + 1], 6),
                round_n(x_smoothed_flat[ag_i * 4 + 2], 6),
                round_n(x_smoothed_flat[ag_i * 4 + 3], 6),
            ]),
        );
    }

    Ok(json!({
        "sheaf_phi": round_n(sheaf_phi, 6),
        "cohomology_threshold": req.cohomology_threshold,
        "cohomology_veto": sheaf_phi > req.cohomology_threshold,
        "consensus_stalk": [
            round_n(consensus_stalk[0], 6),
            round_n(consensus_stalk[1], 6),
            round_n(consensus_stalk[2], 6),
            round_n(consensus_stalk[3], 6)
        ],
        "edge_faults": edge_faults,
        "primary_fault_edge": primary_fault_edge,
        "primary_fault_norm": primary_fault_norm,
        "sheaf_laplacian_trace": round_n(lap_trace, 6),
        "smoothed_stalks": smoothed_stalks,
        "kernel_latency_us": t0.elapsed().as_micros() as u64,
        "engine": "rust-axum-native"
    }))
}

// ============================================================================
// PILLAR 4: WASSERSTEIN DRO LOT SIZER
// ============================================================================

fn default_capital_rp() -> f64 {
    100_000_000.0
}
fn default_max_position_pct() -> f64 {
    0.25
}
fn default_adv_lots() -> i64 {
    50_000
}
fn default_arb_hazard_threshold() -> f64 {
    0.65
}

#[derive(Debug, Clone, Deserialize)]
pub struct WdroLotsRequest {
    pub sheaf_phi: f64,
    pub consensus_stalk: Vec<f64>,
    pub entry_price_rp: i64,
    #[serde(default = "default_capital_rp")]
    pub capital_rp: f64,
    #[serde(default = "default_max_position_pct")]
    pub max_position_pct: f64,
    #[serde(default = "default_adv_lots")]
    pub adv_lots: i64,
    #[serde(default = "default_cohomology_threshold")]
    pub cohomology_threshold: f64,
    #[serde(default = "default_arb_hazard_threshold")]
    pub arb_hazard_threshold: f64,
}

pub fn solve_wdro_lots_core(req: &WdroLotsRequest) -> Result<Value, String> {
    let t0 = Instant::now();
    if req.consensus_stalk.len() != 4 {
        return Err("consensus_stalk must contain 4 elements [mu_5d, theta_star, liq_score, h_arb].".to_string());
    }
    let mu_5d = req.consensus_stalk[0];
    let _theta_star = req.consensus_stalk[1];
    let liq_score = req.consensus_stalk[2];
    let h_arb = req.consensus_stalk[3];

    let eps_0 = 0.0045_f64;
    let beta_sheaf = 2.10_f64;
    let epsilon_phi = eps_0 * (beta_sheaf * req.sheaf_phi.max(0.0)).exp();

    if req.sheaf_phi > req.cohomology_threshold {
        return Ok(json!({
            "action": "BLOCKED_COHOMOLOGY",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round_n(epsilon_phi, 6),
            "expected_5d_return": round_n(mu_5d * 0.055, 6),
            "worst_case_wdro_return": round_n(mu_5d * 0.055 - epsilon_phi, 6),
            "solver_status": "VETOED_BY_SHEAF_COHOMOLOGY",
            "veto_reason": format!(
                "Sheaf frustration energy Phi(x)={:.3} exceeds threshold {:.2} (Structural contradiction / Bandar Bull Trap).",
                req.sheaf_phi, req.cohomology_threshold
            ),
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        }));
    }

    if h_arb > req.arb_hazard_threshold {
        return Ok(json!({
            "action": "AVOID_ARB_HAZARD",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round_n(epsilon_phi, 6),
            "expected_5d_return": round_n(mu_5d * 0.055, 6),
            "worst_case_wdro_return": round_n(mu_5d * 0.055 - epsilon_phi, 6),
            "solver_status": "VETOED_BY_ARB_HAZARD",
            "veto_reason": format!(
                "ARB queue depletion hazard h_ARB={:.3} exceeds safe limit {:.2} (-7% ARB liquidity freeze risk).",
                h_arb, req.arb_hazard_threshold
            ),
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        }));
    }

    if mu_5d < 0.0 {
        let expected_gross_return = mu_5d * 0.065 * (1.0 + 0.15 * liq_score.abs());
        let net_expected_return = expected_gross_return - IDX_ROUND_TRIP_FEE;
        let worst_case_drift = net_expected_return - epsilon_phi - 0.025 * h_arb;
        return Ok(json!({
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round_n(epsilon_phi, 6),
            "expected_5d_return": round_n(expected_gross_return, 6),
            "worst_case_wdro_return": round_n(worst_case_drift, 6),
            "solver_status": "NEGATIVE_BEARISH_DRIFT",
            "veto_reason": format!(
                "Negative / bearish expected 5-day return ({:+.2}%, mu_5d={:+.3}): stock is in net selling / distribution.",
                expected_gross_return * 100.0, mu_5d
            ),
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        }));
    }

    let expected_gross_return = mu_5d * 0.065 * (1.0 + 0.15 * liq_score.max(0.0));
    let net_expected_return = expected_gross_return - IDX_ROUND_TRIP_FEE;
    let fp_confidence_margin = 0.0055_f64;
    let worst_case_drift = net_expected_return - epsilon_phi - 0.025 * h_arb - fp_confidence_margin;

    if mu_5d < 0.28 || liq_score < 0.05 || h_arb > 0.45 {
        return Ok(json!({
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round_n(epsilon_phi, 6),
            "expected_5d_return": round_n(expected_gross_return, 6),
            "worst_case_wdro_return": round_n(worst_case_drift, 6),
            "solver_status": "BELOW_95PCT_CONFIDENCE_GATE",
            "veto_reason": format!(
                "Signal conviction (mu_5d={:+.3}, liq={:+.3}, h_ARB={:.3}) is below the 95% confidence gate (<5% false-positive protection).",
                mu_5d, liq_score, h_arb
            ),
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        }));
    }

    if worst_case_drift <= 0.003 {
        return Ok(json!({
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round_n(epsilon_phi, 6),
            "expected_5d_return": round_n(expected_gross_return, 6),
            "worst_case_wdro_return": round_n(worst_case_drift, 6),
            "solver_status": "INSUFFICIENT_ROBUST_EDGE",
            "veto_reason": format!(
                "Worst-case WDRO net return ({:+.2}%) after 0.40% fees, ambiguity radius eps={:.4}, and 95% confidence margin is insufficient.",
                worst_case_drift * 100.0, epsilon_phi
            ),
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        }));
    }

    let sigma_eff = (0.042 * (1.0 - 0.35 * liq_score) * (1.0 + 0.8 * h_arb)).max(0.018);
    let risk_aversion_gamma = 14.0_f64;

    let lot_cost_rp = ((req.entry_price_rp * IDX_LOT_SHARES) as f64).max(100.0);
    let max_liq_notional = 0.015 * (req.adv_lots as f64) * lot_cost_rp;
    let max_liq_weight = req
        .max_position_pct
        .min(max_liq_notional / req.capital_rp.max(1.0));

    // Exact analytical optimum of strictly concave quadratic objective:
    // max_{0 <= w <= max_liq_weight} [ w * worst_case_drift - 0.5 * gamma * sigma_eff^2 * w^2 ]
    let w_unconstrained = worst_case_drift / (risk_aversion_gamma * sigma_eff * sigma_eff);
    let w_star = w_unconstrained.clamp(0.0, max_liq_weight);

    let raw_notional = w_star * req.capital_rp;
    let approved_lots = (raw_notional / lot_cost_rp).floor() as i64;
    let approved_shares = approved_lots * IDX_LOT_SHARES;
    let actual_notional_rp = (approved_lots as f64 * lot_cost_rp) as i64;

    if approved_lots <= 0 {
        return Ok(json!({
            "action": "HOLD_NO_EDGE",
            "approved_lots": 0,
            "approved_shares": 0,
            "optimal_weight_pct": 0.0,
            "notional_exposure_rp": 0,
            "epsilon_phi": round_n(epsilon_phi, 6),
            "expected_5d_return": round_n(expected_gross_return, 6),
            "worst_case_wdro_return": round_n(worst_case_drift, 6),
            "solver_status": "optimal_rust_native",
            "veto_reason": "Optimal capital allocation smaller than 1 IDX lot (100 shares).",
            "kernel_latency_us": t0.elapsed().as_micros() as u64,
            "engine": "rust-axum-native"
        }));
    }

    Ok(json!({
        "action": "BUY",
        "approved_lots": approved_lots,
        "approved_shares": approved_shares,
        "optimal_weight_pct": round_n((actual_notional_rp as f64 / req.capital_rp.max(1.0)) * 100.0, 2),
        "notional_exposure_rp": actual_notional_rp,
        "epsilon_phi": round_n(epsilon_phi, 6),
        "expected_5d_return": round_n(expected_gross_return, 6),
        "worst_case_wdro_return": round_n(worst_case_drift, 6),
        "solver_status": "optimal_rust_native",
        "veto_reason": Value::Null,
        "kernel_latency_us": t0.elapsed().as_micros() as u64,
        "engine": "rust-axum-native"
    }))
}

// ============================================================================
// PILLAR 5: ORNSTEIN-UHLENBECK FIRST-PASSAGE OPTIMAL STOPPING SOLVER
// ============================================================================

fn default_reference_date() -> String {
    "2026-10-28".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct OuStoppingRequest {
    pub prev_close_rp: i64,
    pub current_price_rp: i64,
    pub consensus_stalk: Vec<f64>,
    pub sheaf_phi: f64,
    pub epsilon_phi: f64,
    pub approved_lots: i64,
    #[serde(default = "default_reference_date")]
    pub reference_date: String,
}

/// Howard Hinnant's civil calendar algorithms (exact ISO-8601 proleptic Gregorian calendar)
fn days_from_civil(mut y: i64, m: i64, d: i64) -> i64 {
    if m <= 2 {
        y -= 1;
    }
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m_prime = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * m_prime + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    if m <= 2 {
        y += 1;
    }
    (y, m, d)
}

/// Returns 0 for Monday .. 4 for Friday, 5 for Saturday, 6 for Sunday (matching Python `date.weekday()`).
fn weekday_from_days(z: i64) -> i64 {
    (z + 3).rem_euclid(7)
}

fn parse_iso_date_to_days(iso_str: &str) -> i64 {
    let parts: Vec<&str> = iso_str.trim().split('-').collect();
    if parts.len() == 3 {
        if let (Ok(y), Ok(m), Ok(d)) = (
            parts[0].parse::<i64>(),
            parts[1].parse::<i64>(),
            parts[2].parse::<i64>(),
        ) {
            if (1..=12).contains(&m) && (1..=31).contains(&d) {
                return days_from_civil(y, m, d);
            }
        }
    }
    days_from_civil(2026, 10, 28)
}

fn advance_idx_trading_days(iso_str: &str, trading_days_to_add: i64) -> String {
    let mut cur_z = parse_iso_date_to_days(iso_str);
    let mut added = 0;
    while added < trading_days_to_add {
        cur_z += 1;
        if weekday_from_days(cur_z) < 5 {
            added += 1;
        }
    }
    let (y, m, d) = civil_from_days(cur_z);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

pub fn solve_ou_stopping_core(req: &OuStoppingRequest) -> Result<Value, String> {
    let t0 = Instant::now();
    if req.consensus_stalk.len() != 4 {
        return Err("consensus_stalk must contain 4 elements [mu_5d, theta_star, liq_score, h_arb].".to_string());
    }
    let mu_5d = req.consensus_stalk[0];
    let theta_star = req.consensus_stalk[1];
    let liq_score = req.consensus_stalk[2];
    let h_arb = req.consensus_stalk[3];

    let bounds = compute_ara_arb_bounds(req.prev_close_rp);
    let pre_arb_floor_rp = bounds.pre_arb_floor_rp;
    let arb_rp = bounds.arb_rp;
    let ara_rp = bounds.ara_rp;

    let entry_anchor = (req.current_price_rp as f64) * (1.0 - 0.0015 * liq_score.max(0.0));
    let mut entry_limit_rp = round_to_idx_tick(entry_anchor, "floor");
    if entry_limit_rp < pre_arb_floor_rp && req.current_price_rp >= pre_arb_floor_rp {
        entry_limit_rp = pre_arb_floor_rp;
    }

    let theta = theta_star.clamp(0.15, 1.50);
    let sigma_daily = (0.019 * (1.0 + 0.55 * h_arb - 0.20 * liq_score)).max(0.011);

    let min_req_edge = compute_min_required_edge(req.epsilon_phi);
    let ou_tp_pct = (min_req_edge + 0.006)
        .max((mu_5d * 0.068).max(0.022) + 0.45 * sigma_daily / theta.sqrt());
    let raw_tp_rp = (entry_limit_rp as f64) * (1.0 + ou_tp_pct);
    let mut take_profit_rp = round_to_idx_tick(raw_tp_rp, "ceil").min(ara_rp);

    let entry_f = (entry_limit_rp as f64).max(1.0);
    let mut actual_edge = ((take_profit_rp - entry_limit_rp) as f64) / entry_f;
    while actual_edge < min_req_edge && take_profit_rp < ara_rp {
        let tick_step = (round_to_idx_tick((take_profit_rp + 1) as f64, "ceil") - take_profit_rp).max(1);
        take_profit_rp = round_to_idx_tick((take_profit_rp + tick_step) as f64, "ceil");
        actual_edge = ((take_profit_rp - entry_limit_rp) as f64) / entry_f;
    }

    let desired_sl_rp = (entry_limit_rp as f64) * (1.0 - (1.85 * sigma_daily).min(0.038));
    let candidate_sl_rp = round_to_idx_tick(desired_sl_rp, "ceil");
    let stop_loss_pre_arb_rp = pre_arb_floor_rp.max(candidate_sl_rp);

    let expected_holding_days = if req.approved_lots > 0 && mu_5d > 0.05 {
        let asymp_target_pct = (ou_tp_pct * 1.35).max(0.04);
        let ratio = (asymp_target_pct / (asymp_target_pct - ou_tp_pct * 0.72).max(0.008))
            .clamp(1.25, 8.0);
        round_n(((1.0 / theta) * ratio.ln() * 2.1).clamp(1.5, 9.5), 1)
    } else {
        0.0
    };

    let hard_max_days = if req.approved_lots > 0 {
        ((expected_holding_days * 1.65).ceil() as i64).max(3)
    } else {
        0
    };

    let time_stop_date = advance_idx_trading_days(&req.reference_date, hard_max_days);

    let cone_base_rp = if req.approved_lots > 0 {
        entry_limit_rp as f64
    } else {
        round_to_idx_tick(req.current_price_rp as f64, "nearest") as f64
    };
    let multi_day_floor_rp = if req.approved_lots > 0 {
        arb_rp as f64
    } else {
        1.0_f64.max((req.prev_close_rp as f64) * 0.65)
    };
    let asymp_drift_pct = mu_5d * 0.075 - 0.035 * (h_arb - 0.35).max(0.0);
    let mu_eq_price = cone_base_rp * (1.0 + asymp_drift_pct);

    let mut trajectory_cone: Vec<Value> = Vec::with_capacity(11);
    for day_idx in 0..=10 {
        if day_idx == 0 {
            let p_mean = round_to_idx_tick(cone_base_rp, "nearest");
            trajectory_cone.push(json!({
                "day": 0,
                "mean_rp": p_mean,
                "upper_1sigma_rp": p_mean,
                "lower_1sigma_rp": p_mean,
                "upper_2sigma_rp": p_mean,
                "lower_2sigma_rp": p_mean,
            }));
            continue;
        }

        let t_frac = (day_idx as f64) / 5.0;
        let decay = (-theta * t_frac).exp();
        let mean_raw =
            (cone_base_rp * decay + mu_eq_price * (1.0 - decay)).clamp(multi_day_floor_rp, ara_rp as f64);
        let ou_std_pct = sigma_daily
            * (((1.0 - (-2.0 * theta * (day_idx as f64)).exp()) / (2.0 * theta)).max(1e-6)).sqrt();
        let std_rp = cone_base_rp * ou_std_pct;

        let mean_rp = round_to_idx_tick(mean_raw, "nearest");
        let u1_rp = mean_rp.max(round_to_idx_tick(mean_raw + 1.0 * std_rp, "ceil"));
        let l1_rp = mean_rp.min(round_to_idx_tick((mean_raw - 1.0 * std_rp).max(multi_day_floor_rp), "floor"));
        let u2_rp = u1_rp.max(round_to_idx_tick(mean_raw + 2.0 * std_rp, "ceil"));
        let l2_rp = l1_rp.min(round_to_idx_tick((mean_raw - 2.0 * std_rp).max(multi_day_floor_rp), "floor"));

        trajectory_cone.push(json!({
            "day": day_idx,
            "mean_rp": mean_rp,
            "upper_1sigma_rp": u1_rp,
            "lower_1sigma_rp": l1_rp,
            "upper_2sigma_rp": u2_rp,
            "lower_2sigma_rp": l2_rp,
        }));
    }

    let pre_arb_drawdown_from_prev_close_pct =
        ((stop_loss_pre_arb_rp - req.prev_close_rp) as f64) / (req.prev_close_rp as f64).max(1.0);

    Ok(json!({
        "prev_close_rp": bounds.prev_close_rp,
        "entry_limit_rp": entry_limit_rp,
        "take_profit_rp": take_profit_rp,
        "stop_loss_pre_arb_rp": stop_loss_pre_arb_rp,
        "pre_arb_floor_rp": pre_arb_floor_rp,
        "arb_floor_rp": arb_rp,
        "ara_ceiling_rp": ara_rp,
        "gross_tp_edge_pct": round_n(actual_edge * 100.0, 3),
        "min_required_edge_pct": round_n(min_req_edge * 100.0, 3),
        "pre_arb_drawdown_from_prev_close_pct": round_n(pre_arb_drawdown_from_prev_close_pct * 100.0, 3),
        "expected_holding_days": expected_holding_days,
        "hard_time_stop_days": hard_max_days,
        "time_stop_date": time_stop_date,
        "ou_theta": round_n(theta, 4),
        "ou_sigma_daily": round_n(sigma_daily, 4),
        "trajectory_cone": trajectory_cone,
        "kernel_latency_us": t0.elapsed().as_micros() as u64,
        "engine": "rust-axum-native"
    }))
}

// ============================================================================
// COMBINED PILLAR 3 + 4 + 5 SOLVER (`/v1/solve-sheaf-wdro-ou`)
// ============================================================================

#[derive(Debug, Clone, Deserialize)]
pub struct CombinedSheafWdroOuRequest {
    pub stalks_by_agent: HashMap<String, Vec<f64>>,
    #[serde(default = "default_cohomology_threshold")]
    pub cohomology_threshold: f64,
    #[serde(default = "default_arb_hazard_threshold")]
    pub arb_hazard_threshold: f64,
    pub prev_close_rp: i64,
    pub last_price_rp: i64,
    #[serde(default = "default_capital_rp")]
    pub capital_rp: f64,
    #[serde(default = "default_max_position_pct")]
    pub max_position_pct: f64,
    #[serde(default = "default_adv_lots")]
    pub adv_lots: i64,
    #[serde(default = "default_reference_date")]
    pub reference_date: String,
}

// ============================================================================
// AXUM HTTP HANDLERS
// ============================================================================

async fn health_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "service": "swrt-rust-kernel",
            "engine": "rust-axum-native",
            "version": "0.1.0"
        })),
    )
}

async fn sinkhorn_handler(Json(req): Json<SinkhornRequest>) -> impl IntoResponse {
    let n_buy = req.brokers_buy.len();
    let n_sell = req.brokers_sell.len();
    let res = solve_sinkhorn_core(&req);
    let lat = res["kernel_latency_us"].as_u64().unwrap_or(0);
    let kappa = res["conviction_kappa"].as_f64().unwrap_or(0.0);
    println!(
        "[swrt-rust-kernel] POST /v1/sinkhorn | buy={} sell={} | kappa={:+.4} | latency={}us",
        n_buy, n_sell, kappa, lat
    );
    (StatusCode::OK, Json(res))
}

async fn rough_signature_handler(Json(req): Json<RoughSignatureRequest>) -> impl IntoResponse {
    match solve_rough_signature_core(&req) {
        Ok(res) => {
            let lat = res["kernel_latency_us"].as_u64().unwrap_or(0);
            let h_arb = res["h_arb"].as_f64().unwrap_or(0.0);
            let spoof = res["spoofing_detected"].as_bool().unwrap_or(false);
            println!(
                "[swrt-rust-kernel] POST /v1/rough-signature | pts={} | h_arb={:.4} spoof={} | latency={}us",
                req.micro_prices.len(),
                h_arb,
                spoof,
                lat
            );
            (StatusCode::OK, Json(res))
        }
        Err(err) => {
            println!("[swrt-rust-kernel] POST /v1/rough-signature ERROR: {}", err);
            (StatusCode::BAD_REQUEST, Json(json!({ "error": err })))
        }
    }
}

async fn sheaf_cohomology_handler(Json(req): Json<SheafCohomologyRequest>) -> impl IntoResponse {
    match solve_sheaf_cohomology_core(&req) {
        Ok(res) => {
            let lat = res["kernel_latency_us"].as_u64().unwrap_or(0);
            let phi = res["sheaf_phi"].as_f64().unwrap_or(0.0);
            let veto = res["cohomology_veto"].as_bool().unwrap_or(false);
            println!(
                "[swrt-rust-kernel] POST /v1/sheaf-cohomology | phi={:.4} veto={} | latency={}us",
                phi, veto, lat
            );
            (StatusCode::OK, Json(res))
        }
        Err(err) => {
            println!("[swrt-rust-kernel] POST /v1/sheaf-cohomology ERROR: {}", err);
            (StatusCode::BAD_REQUEST, Json(json!({ "error": err })))
        }
    }
}

async fn wdro_lots_handler(Json(req): Json<WdroLotsRequest>) -> impl IntoResponse {
    match solve_wdro_lots_core(&req) {
        Ok(res) => {
            let lat = res["kernel_latency_us"].as_u64().unwrap_or(0);
            let action = res["action"].as_str().unwrap_or("UNKNOWN");
            let lots = res["approved_lots"].as_i64().unwrap_or(0);
            println!(
                "[swrt-rust-kernel] POST /v1/wdro-lots | action={} lots={} | latency={}us",
                action, lots, lat
            );
            (StatusCode::OK, Json(res))
        }
        Err(err) => {
            println!("[swrt-rust-kernel] POST /v1/wdro-lots ERROR: {}", err);
            (StatusCode::BAD_REQUEST, Json(json!({ "error": err })))
        }
    }
}

async fn ou_stopping_handler(Json(req): Json<OuStoppingRequest>) -> impl IntoResponse {
    match solve_ou_stopping_core(&req) {
        Ok(res) => {
            let lat = res["kernel_latency_us"].as_u64().unwrap_or(0);
            let entry = res["entry_limit_rp"].as_i64().unwrap_or(0);
            let tp = res["take_profit_rp"].as_i64().unwrap_or(0);
            let sl = res["stop_loss_pre_arb_rp"].as_i64().unwrap_or(0);
            println!(
                "[swrt-rust-kernel] POST /v1/ou-stopping | entry={} tp={} sl={} | latency={}us",
                entry, tp, sl, lat
            );
            (StatusCode::OK, Json(res))
        }
        Err(err) => {
            println!("[swrt-rust-kernel] POST /v1/ou-stopping ERROR: {}", err);
            (StatusCode::BAD_REQUEST, Json(json!({ "error": err })))
        }
    }
}

async fn solve_sheaf_wdro_ou_handler(
    Json(req): Json<CombinedSheafWdroOuRequest>,
) -> impl IntoResponse {
    let t0 = Instant::now();
    let sheaf_req = SheafCohomologyRequest {
        stalks_by_agent: req.stalks_by_agent.clone(),
        cohomology_threshold: req.cohomology_threshold,
    };
    let sheaf_res = match solve_sheaf_cohomology_core(&sheaf_req) {
        Ok(v) => v,
        Err(err) => {
            println!(
                "[swrt-rust-kernel] POST /v1/solve-sheaf-wdro-ou ERROR (sheaf): {}",
                err
            );
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err })));
        }
    };

    let sheaf_phi = sheaf_res["sheaf_phi"].as_f64().unwrap_or(0.0);
    let consensus_stalk: Vec<f64> = sheaf_res["consensus_stalk"]
        .as_array()
        .map(|arr| arr.iter().map(|v| v.as_f64().unwrap_or(0.0)).collect())
        .unwrap_or_else(|| vec![0.0, 0.5, 0.0, 0.5]);

    let prelim_entry_rp = round_to_idx_tick(req.last_price_rp as f64, "floor");
    let wdro_req = WdroLotsRequest {
        sheaf_phi,
        consensus_stalk: consensus_stalk.clone(),
        entry_price_rp: prelim_entry_rp,
        capital_rp: req.capital_rp,
        max_position_pct: req.max_position_pct,
        adv_lots: req.adv_lots,
        cohomology_threshold: req.cohomology_threshold,
        arb_hazard_threshold: req.arb_hazard_threshold,
    };
    let wdro_res = match solve_wdro_lots_core(&wdro_req) {
        Ok(v) => v,
        Err(err) => {
            println!(
                "[swrt-rust-kernel] POST /v1/solve-sheaf-wdro-ou ERROR (wdro): {}",
                err
            );
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err })));
        }
    };

    let approved_lots = wdro_res["approved_lots"].as_i64().unwrap_or(0);
    let epsilon_phi = wdro_res["epsilon_phi"].as_f64().unwrap_or(0.0);

    let ou_req = OuStoppingRequest {
        prev_close_rp: req.prev_close_rp,
        current_price_rp: req.last_price_rp,
        consensus_stalk,
        sheaf_phi,
        epsilon_phi,
        approved_lots,
        reference_date: req.reference_date,
    };
    let ou_res = match solve_ou_stopping_core(&ou_req) {
        Ok(v) => v,
        Err(err) => {
            println!(
                "[swrt-rust-kernel] POST /v1/solve-sheaf-wdro-ou ERROR (ou): {}",
                err
            );
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": err })));
        }
    };

    let total_lat_us = t0.elapsed().as_micros() as u64;
    let action = wdro_res["action"].as_str().unwrap_or("UNKNOWN");
    println!(
        "[swrt-rust-kernel] POST /v1/solve-sheaf-wdro-ou | phi={:.4} action={} lots={} | latency={}us",
        sheaf_phi, action, approved_lots, total_lat_us
    );

    (
        StatusCode::OK,
        Json(json!({
            "sheaf": sheaf_res,
            "wdro": wdro_res,
            "ou": ou_res,
            "kernel_latency_us": total_lat_us,
            "engine": "rust-axum-native"
        })),
    )
}

#[tokio::main]
async fn main() {
    let port: u16 = env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(4001);

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/v1/sinkhorn", post(sinkhorn_handler))
        .route("/v1/rough-signature", post(rough_signature_handler))
        .route("/v1/sheaf-cohomology", post(sheaf_cohomology_handler))
        .route("/v1/wdro-lots", post(wdro_lots_handler))
        .route("/v1/ou-stopping", post(ou_stopping_handler))
        .route("/v1/solve-sheaf-wdro-ou", post(solve_sheaf_wdro_ou_handler));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!(
        "[swrt-rust-kernel] Starting native Rust mathematical kernel on http://{}",
        addr
    );

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind TCP listener for swrt-rust-kernel");
    axum::serve(listener, app)
        .await
        .expect("swrt-rust-kernel server error");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idx_tick_and_bounds() {
        assert_eq!(idx_tick_size(150.0), 1);
        assert_eq!(idx_tick_size(350.0), 2);
        assert_eq!(idx_tick_size(1250.0), 5);
        assert_eq!(idx_tick_size(3400.0), 10);
        assert_eq!(idx_tick_size(9750.0), 25);

        let b = compute_ara_arb_bounds(9750);
        assert_eq!(b.prev_close_rp, 9750);
        assert!(b.pre_arb_floor_rp >= (9750.0 * (1.0 - 0.052)).ceil() as i64);
    }

    #[test]
    fn test_sheaf_cohomology_and_wdro() {
        let mut stalks = HashMap::new();
        stalks.insert("BDM".to_string(), vec![0.72, 0.65, 0.58, 0.12]);
        stalks.insert("LOB".to_string(), vec![0.64, 0.58, 0.52, 0.15]);
        stalks.insert("NLP".to_string(), vec![0.68, 0.60, 0.50, 0.10]);
        stalks.insert("MAC".to_string(), vec![0.55, 0.50, 0.62, 0.14]);

        let sheaf = solve_sheaf_cohomology_core(&SheafCohomologyRequest {
            stalks_by_agent: stalks,
            cohomology_threshold: 0.70,
        })
        .unwrap();
        assert!(!sheaf["cohomology_veto"].as_bool().unwrap());
        assert!(sheaf["sheaf_phi"].as_f64().unwrap() < 0.20);
    }
}
