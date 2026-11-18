# shared switch that every part reads
# true by default
# Learner Lab can not create roles so every lambda uses LabRole
# false in a normal AWS account
# one small role per function from the docs iam files
variable "use_lab_role" {
  description = "true in Learner Lab (all Lambdas run as LabRole); false in a normal AWS account (one role per function from docs/iam)."
  type        = bool
  default     = true
}
