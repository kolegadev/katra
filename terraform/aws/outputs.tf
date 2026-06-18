# ─────────────────────────────────────────────────────────────
# Katra — Outputs
# ─────────────────────────────────────────────────────────────

output "alb_dns" {
  description = "Application Load Balancer DNS hostname"
  value       = aws_lb.katra.dns_name
}

output "rest_api_url" {
  description = "Katra REST API health-check URL"
  value       = "http://${aws_lb.katra.dns_name}/api/v1/health"
}

output "mcp_url" {
  description = "Katra MCP endpoint URL"
  value       = "http://${aws_lb.katra.dns_name}/mcp"
}

output "documentdb_endpoint" {
  description = "DocumentDB cluster endpoint (hostname:port)"
  value       = "${aws_docdb_cluster.katra.endpoint}:${aws_docdb_cluster.katra.port}"
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint (hostname:port)"
  value       = "${aws_elasticache_replication_group.katra.primary_endpoint_address}:${aws_elasticache_replication_group.katra.port}"
}

output "s3_bucket_name" {
  description = "S3 bucket name for Katra assets"
  value       = aws_s3_bucket.assets.id
}

output "ecs_cluster_name" {
  description = "ECS Fargate cluster name"
  value       = aws_ecs_cluster.katra.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.katra.name
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group for ECS container logs"
  value       = aws_cloudwatch_log_group.katra.name
}

output "secrets_manager_arn" {
  description = "ARN of the Secrets Manager secret"
  value       = aws_secretsmanager_secret.katra.arn
}

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}
