module "core" {
  source = "./modules/core"
  route_throttles = [{
    route_key   = aws_apigatewayv2_route.webhook.route_key
    rate_limit  = 10
    burst_limit = 25
  }]
}
