export interface StalkVector4D {
  agent_id: "BDM" | "LOB" | "NLP" | "MAC";
  ticker: string;
  mu_5d: number;
  theta_star: number;
  liquidity_score: number;
  h_arb: number;
  summary_rationale: string;
  diagnostics: Record<string, any>;
}

export interface EdgeFault {
  edge: string;
  source: string;
  target: string;
  weight: number;
  fault_norm: number;
  mu_5d_discrepancy: number;
  is_contradiction: boolean;
}

export interface TrajectoryPoint {
  day: number;
  mean_rp: number;
  upper_1sigma_rp: number;
  lower_1sigma_rp: number;
  upper_2sigma_rp: number;
  lower_2sigma_rp: number;
}

export interface UnifiedDecisionCard {
  ticker: string;
  regime: "COHERENT_ACCUMULATION" | "BANDAR_BULL_TRAP" | "ARB_LIQUIDITY_CASCADE" | "LIVE_MARKET_FEED" | string;
  action: "BUY" | "BLOCKED_COHOMOLOGY" | "AVOID_ARB_HAZARD" | "HOLD_NO_EDGE";
  approved_lots: number;
  approved_shares: number;
  optimal_weight_pct: number;
  notional_exposure_rp: number;
  prev_close_rp: number;
  last_price_rp: number;
  entry_limit_rp: number;
  take_profit_rp: number;
  stop_loss_pre_arb_rp: number;
  pre_arb_floor_rp: number;
  arb_floor_rp: number;
  ara_ceiling_rp: number;
  gross_tp_edge_pct: number;
  min_required_edge_pct: number;
  pre_arb_drawdown_from_prev_close_pct: number;
  expected_holding_days: number;
  hard_time_stop_days: number;
  time_stop_date: string;
  sheaf_phi: number;
  cohomology_threshold: number;
  cohomology_veto: boolean;
  epsilon_phi: number;
  h_arb: number;
  primary_fault_edge: string;
  primary_fault_norm: number;
  veto_reason: string | null;
  consensus_stalk: [number, number, number, number];
  stalks: {
    BDM: StalkVector4D;
    LOB: StalkVector4D;
    NLP: StalkVector4D;
    MAC: StalkVector4D;
  };
  edge_faults: EdgeFault[];
  trajectory_cone: TrajectoryPoint[];
  pillar_diagnostics: Record<string, any>;
  parquet_uri: string;
  snapshot_sha256: string;
  prev_merkle_hash: string;
  receipt_sha256: string;
  seq_id?: number;
  created_at_utc?: string;
}

export interface AuditReceiptRow {
  seq_id: number;
  created_at_utc: string;
  ticker: string;
  regime: string;
  action: string;
  approved_lots: number;
  sheaf_phi: number;
  h_arb: number;
  entry_limit_rp: number;
  take_profit_rp: number;
  stop_loss_pre_arb_rp: number;
  parquet_uri: string;
  snapshot_sha256: string;
  prev_merkle_hash: string;
  receipt_sha256: string;
  decision: UnifiedDecisionCard;
}

export interface AuditVaultPayload {
  updated_at_utc: string;
  verification: {
    valid: boolean;
    total_receipts: number;
    head_receipt_sha256: string;
    errors: string[];
  };
  receipts: AuditReceiptRow[];
}
