resource "aws_sns_topic" "alerts" {
  name = "gk-alerts"
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "gk-api-5xx"
  alarm_description   = "GateKeeper HTTP API returned a server error."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = module.core.api_id }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
}

output "alerts_topic_arn" {
  value = aws_sns_topic.alerts.arn
}
