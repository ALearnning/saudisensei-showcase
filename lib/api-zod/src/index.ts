export * from "./generated/api";
export * from "./generated/types";
// Orval uses *Params for both this path validator and its query-only TS type.
// Resolve that one collision explicitly; retain both under unambiguous names.
export { AdminQuestionBankRevisionListParams } from "./generated/api";
export type { AdminQuestionBankRevisionListParams as AdminQuestionBankRevisionListQuery } from "./generated/types";
export { AdminQuizListParams, AdminQuizRevisionListParams } from "./generated/api";
export type {
  AdminQuizListParams as AdminQuizListQuery,
  AdminQuizRevisionListParams as AdminQuizRevisionListQuery,
} from "./generated/types";
export { StudentQuizListParams, StudentQuizGetParams } from "./generated/api";
export type {
  StudentQuizListParams as StudentQuizListQuery,
  StudentQuizGetParams as StudentQuizGetQuery,
} from "./generated/types";
export * as AssessmentSchemas from "./assessment-contracts";
