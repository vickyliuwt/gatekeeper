# Shared switch, declared once so every part can read it (proposal: "Learner Lab plan B").
#   true  (default): AWS Academy Learner Lab denies iam:CreateRole, so every Lambda runs as the existing LabRole.
#   false: a normal AWS account; each part builds one least-privilege role per function from docs/iam/*.json.
variable "use_lab_role" {
  description = "true in Learner Lab (all Lambdas run as LabRole); false in a normal AWS account (one role per function from docs/iam)."
  type        = bool
  default     = true
}
