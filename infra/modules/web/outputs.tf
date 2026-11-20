output "route_throttles" {
  description = "Per-route limits for module.core. route_key points at the routes, so the stage waits for them."

  value = concat(
    [{ route_key = aws_apigatewayv2_route.submit.route_key, rate_limit = 1, burst_limit = 5 }],
    # every results route has burst 5
    # so one burst never starts more lambdas than our safety line
    # the poll route keeps a higher rate because the page asks it every 2 s
    [for name, route in aws_apigatewayv2_route.results : {
      route_key   = route.route_key
      rate_limit  = name == "status" ? 5 : 2
      burst_limit = 5
    }]
  )
}

output "submit_function_name" {
  value = aws_lambda_function.submit.function_name
}

output "results_function_name" {
  value = aws_lambda_function.results.function_name
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.web.dashboard_name
}
