# Part B (Yuyao): scan worker. Stub: the worker stays off until Part B replaces this file.
# Keep the variable lock_reports_to_worker when you replace it: infra/core.tf passes it to the core module.
variable "enable_worker" {
  description = "Turn on Part B: gk-worker, its queue trigger and its alarms."
  type        = bool
  default     = false
}

variable "worker_image_digest" {
  description = "Digest of the gatekeeper/worker image in ECR (sha256:...). Empty while Part B is off."
  type        = string
  default     = ""
}

variable "worker_max_concurrency" {
  description = "Most workers running at once (proposal slide 10)."
  type        = number
  default     = 2
}

variable "lock_reports_to_worker" {
  description = "Week-1 test: deny writes to reports/ unless the caller is gk-worker."
  type        = bool
  default     = false
}
