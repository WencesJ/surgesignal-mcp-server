import { z } from "zod";
import {
  SIGNAL_SOURCES,
  COVERED_TOPICS,
  SURGE_MIN,
  SURGE_MAX,
  DEFAULT_SCAN_LIMIT,
  MAX_SCAN_LIMIT,
} from "../constants.js";

export const RawSignalSchema = z.object({
  source: z.enum(SIGNAL_SOURCES),
  domain: z.string().min(1),
  topic: z.enum(COVERED_TOPICS),
  score: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
  evidence_url: z.string().url().optional(),
  evidence_snippet: z.string().max(500).optional(),
  person_hint: z.string().max(200).optional(),
});

export type RawSignal = z.infer<typeof RawSignalSchema>;

export const SignalBreakdownSchema = z.object({
  source: z.enum(SIGNAL_SOURCES),
  raw_score: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  weighted_score: z.number().min(0).max(100),
  signal_count: z.number().int().min(0),
  freshest_signal: z.string().datetime().optional(),
  top_evidence: z.string().max(500).optional(),
});

export type SignalBreakdown = z.infer<typeof SignalBreakdownSchema>;

export const SurgeScoreSchema = z.object({
  domain: z.string().min(1),
  company_name: z.string().optional(),
  topic: z.enum(COVERED_TOPICS),
  surge_score: z.number().int().min(SURGE_MIN).max(SURGE_MAX),
  is_surging: z.boolean(),
  data_freshness: z.enum(["fresh", "stale"]),
  freshness_secs: z.number().int().min(0),
  signal_breakdown: z.array(SignalBreakdownSchema),
  total_signals: z.number().int().min(0),
  scored_at: z.string().datetime(),
});

export type SurgeScore = z.infer<typeof SurgeScoreSchema>;

export const LookupSurgeInputSchema = z.object({
  domain: z.string().min(1).max(253),
  topic: z.enum(COVERED_TOPICS),
}).strict();

export type LookupSurgeInput = z.infer<typeof LookupSurgeInputSchema>;

export const ScanTopicInputSchema = z.object({
  topic: z.enum(COVERED_TOPICS),
  min_score: z.number().int().min(0).max(100).default(SURGE_MIN),
  limit: z.number().int().min(1).max(MAX_SCAN_LIMIT).default(DEFAULT_SCAN_LIMIT),
  offset: z.number().int().min(0).default(0),
}).strict();

export type ScanTopicInput = z.infer<typeof ScanTopicInputSchema>;

export const ExplainSignalsInputSchema = z.object({
  domain: z.string().min(1).max(253),
  topic: z.enum(COVERED_TOPICS),
}).strict();

export type ExplainSignalsInput = z.infer<typeof ExplainSignalsInputSchema>;

export const LookupSurgeOutputSchema = SurgeScoreSchema;

export const ScanTopicOutputSchema = z.object({
  topic: z.enum(COVERED_TOPICS),
  total: z.number().int().min(0),
  count: z.number().int().min(0),
  offset: z.number().int().min(0),
  has_more: z.boolean(),
  companies: z.array(SurgeScoreSchema),
});

export type ScanTopicOutput = z.infer<typeof ScanTopicOutputSchema>;

export const ExplainSignalsOutputSchema = z.object({
  domain: z.string(),
  company_name: z.string().optional(),
  topic: z.enum(COVERED_TOPICS),
  surge_score: z.number().int().min(SURGE_MIN).max(SURGE_MAX),
  is_surging: z.boolean(),
  signals: z.array(RawSignalSchema),
  signal_count_by_source: z.record(z.enum(SIGNAL_SOURCES), z.number().int()),
  scoring_formula: z.string(),
});

export type ExplainSignalsOutput = z.infer<typeof ExplainSignalsOutputSchema>;