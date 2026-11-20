variable "alert_email" {
  description = "Email address for GateKeeper alarm notifications."
  type        = string
  default     = null
}

resource "aws_sns_topic_subscription" "alert_email" {
  count     = var.alert_email == null ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
