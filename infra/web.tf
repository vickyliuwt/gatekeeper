# Part C (Weiting): stub. Part C replaces this whole file with its real resources. Only Part C edits it.
variable "enable_web" {
  description = "Part C switch: off until the Part C resources are added."
  type        = bool
  default     = false
}

variable "web_image_digest" {
  description = "Digest of the gatekeeper/web image (sha256:...). Unused until the Part C resources are added."
  type        = string
  default     = null
}

locals {
  # infra/core.tf adds these to the API stage. Empty until Part C adds its routes.
  web_route_throttles = []
}
