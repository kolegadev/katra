# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | ✅ Active development |

## Reporting a Vulnerability

Katra takes security seriously. If you discover a security vulnerability, please follow responsible disclosure:

1. **Do not** open a public GitHub issue
2. Send details to the maintainers via the GitHub Security Advisory tab:
   - Go to https://github.com/kolegadev/Katra-Agentic-Memory/security/advisories
   - Click "Report a vulnerability"
   - Provide a detailed description including steps to reproduce

Alternatively, email security concerns to the repository maintainer.

### What to include

- Type of vulnerability (e.g., SQL injection, XSS, authentication bypass)
- Full path to the affected file(s)
- Steps to reproduce
- Proof of concept (if available)
- Impact assessment

### Response timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Fix timeline**: Depends on severity, typically 7-14 days for critical issues

## Security Best Practices

When deploying Katra:

1. **Always set strong API keys** in `.env` — do not rely on auto-generated defaults in production
2. **Use HTTPS** in production — never expose the MCP or API endpoints over plain HTTP
3. **Restrict network access** — use firewalls or security groups to limit which IPs can reach Katra
4. **Keep dependencies updated** — regularly run `npm audit` in the server directory
5. **Use environment-specific `.env` files** — never commit `.env` to version control
6. **Enable multi-tenancy** (`MULTI_TENANT=true`) if serving multiple users/organizations
7. **Monitor logs** for unusual access patterns or authentication failures

## Known Security Features

Katra includes built-in security measures:

- API key authentication on all MCP and admin endpoints
- Rate limiting middleware to prevent abuse
- Input validation and sanitization
- Tenant isolation (database-per-tenant mode)
- Cryptographically secure UUID generation for event IDs
- No hardcoded credentials in source code
- Regular security audits as part of the development process
