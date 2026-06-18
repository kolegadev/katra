# Katra on AWS — Terraform Module

Production-quality infrastructure for **[Katra](https://github.com/user/katra)** — Cognitive Memory as a Service — deployed on AWS with ECS Fargate, DocumentDB, ElastiCache Redis, and S3.

## Architecture

```
                     Internet
                        │
                        ▼
              ┌──────────────────┐
              │   ALB (public)   │
              │  /api/* → :9002  │
              │  /mcp   → :3100  │
              └──────┬───────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
 ┌─────────────┐          ┌─────────────┐
 │ ECS Fargate │          │ ECS Fargate │  ← private subnets
 │  Katra API  │          │  Katra MCP  │     (same task)
 └──┬───┬───┬──┘          └─────────────┘
    │   │   │
    ▼   ▼   ▼
 ┌────┐┌────┐┌──────────┐
 │Doc ││Red ││S3 Assets │  ← private subnets
 │ DB ││is  ││Bucket    │
 └────┘└────┘└──────────┘
```

| Local Service | AWS Replacement       |
|-------------- |-----------------------|
| MongoDB       | Amazon DocumentDB     |
| Redis         | Amazon ElastiCache    |
| MinIO         | Amazon S3             |

## Prerequisites

1. **AWS CLI** — installed and configured (`aws configure`)
2. **Terraform ≥ 1.5** — [install](https://developer.hashicorp.com/terraform/install)
3. **Docker** — to build and push the Katra image
4. An **ECR repository** for the Katra image (see below)

## Quick Start

### 1. Build & Push the Docker Image

```bash
cd /path/to/katra

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com

# Create ECR repo (one-time)
aws ecr create-repository --repository-name katra --region us-east-1

# Build and push
docker build -t katra:latest .
docker tag katra:latest $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/katra:latest
docker push $(aws sts get-caller-identity --query Account --output text).dkr.ecr.us-east-1.amazonaws.com/katra:latest
```

### 2. Configure Variables

Create a `terraform.tfvars` file (or export `TF_VAR_*` environment variables):

```hcl
# terraform.tfvars
aws_region      = "us-east-1"
environment     = "production"
katra_image     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/katra:latest"
katra_api_key   = "your-secure-api-key-here"
deepseek_api_key = "sk-..."          # optional
```

> **Never commit `terraform.tfvars` to version control.** It contains sensitive values.

### 3. Deploy

```bash
cd terraform/aws

terraform init
terraform plan
terraform apply
```

Review the plan output carefully before confirming. Total apply time: **~15–20 minutes** (DocumentDB is the bottleneck).

### 4. Get Outputs

```bash
terraform output

# Test the API
curl $(terraform output -raw rest_api_url)

# Test MCP
curl $(terraform output -raw mcp_url)
```

### 5. Destroy

```bash
terraform destroy
```

> ⚠️ If `environment = "production"`, you must manually disable `deletion_protection` on the ALB and set `skip_final_snapshot = false` before destroy. Adjust `main.tf` first.

## Cost Estimates (us-east-1, on-demand)

| Resource              | Spec             | Monthly ~ |
|----------------------|------------------|-----------|
| ECS Fargate          | 0.5 vCPU / 1 GB | ~$17      |
| DocumentDB           | db.r5.large      | ~$200     |
| ElastiCache Redis    | cache.t3.micro   | ~$13      |
| ALB                  | 1 LCU avg        | ~$22      |
| NAT Gateway          | 1 instance       | ~$35      |
| S3 (10 GB)           | Standard         | ~$0.25    |
| Secrets Manager      | 1 secret         | ~$0.50    |
| CloudWatch Logs      | 5 GB ingest      | ~$3       |
| **Total**            |                  | **~$291** |

> 💡 **Cost-saving tips:**
> - Use `db.t4g.medium` for dev/staging (change `docdb_instance_class`)
> - Set `nat_gateway_count = 1` (default) instead of per-AZ
> - Reduce `docdb_instance_class` to `db.t3.medium` for light workloads
> - Fargate Spot can reduce compute costs ~50% for non-critical environments

## Variables Reference

See [`variables.tf`](./variables.tf) for all inputs with descriptions and defaults.

### Required

| Variable         | Description              |
|-----------------|--------------------------|
| `katra_image`    | ECR image URI            |
| `katra_api_key`  | API key for agent auth   |

### Key Optional

| Variable              | Default          | Description                  |
|-----------------------|------------------|------------------------------|
| `aws_region`          | `us-east-1`      | AWS region                   |
| `environment`         | `production`     | production / staging / dev   |
| `deepseek_api_key`    | `null`           | LLM API key                  |
| `task_cpu`            | `512`            | Fargate CPU units            |
| `task_memory`         | `1024`           | Fargate memory MiB           |
| `docdb_instance_class`| `db.r5.large`    | DocumentDB instance size     |
| `redis_node_type`     | `cache.t3.micro` | Redis node size              |
| `desired_count`       | `1`             | Number of ECS tasks          |
| `llm_provider`        | `deepseek`       | LLM backend                  |
| `multi_tenant`        | `false`          | SaaS multi-tenancy mode      |

## Customization

### Adding HTTPS

The module defaults to HTTP on port 80. For production HTTPS:

1. Request or import an ACM certificate in `us-east-1`
2. Add an HTTPS listener:

```hcl
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.katra.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = "arn:aws:acm:..."

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "OK"
      status_code  = "200"
    }
  }
}
```

Then replicate the path-based listener rules to the HTTPS listener.

### Multi-AZ NAT Gateways

Set `nat_gateway_count = 2` for production HA (adds ~$35/month per extra NAT GW).

### Scaling

For auto-scaling, add `aws_appautoscaling_target` and `aws_appautoscaling_policy` resources to the module, scaling on CPU or request count.

### Custom Domain

Point a Route 53 alias (or CNAME) at `alb_dns` output and update any CORS/origin config in Katra accordingly.

## Security Notes

- DocumentDB, Redis, and ECS tasks all run in private subnets — no direct internet access
- S3 bucket is private with SSE-S3 encryption; access limited to the ECS task IAM role
- Secrets Manager stores all credentials; ECS injects them as environment variables at runtime
- TLS is enabled on DocumentDB (`tls=enabled` cluster parameter)
- Redis encryption at-rest and in-transit is enabled
- ALB deletion protection enabled in production
- DocumentDB deletion protection enabled in production

## File Layout

```
terraform/aws/
├── providers.tf    # Terraform & AWS provider blocks
├── variables.tf    # All input variables
├── main.tf         # All infrastructure resources
├── outputs.tf      # Output values
└── README.md       # This file
```

## License

Same as Katra.
