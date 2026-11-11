# Data Subjects

Identify the correct data subject for each personal data element.

## Definitions

| Data Subject | Definition | Example |
|---|---|---|
| **Enterprise Customer's User (C1 user)** | Users of an enterprise customer's tenant. If Contoso buys Microsoft cloud services, Contoso employees are C1 users. Use when data can be associated with an authenticated C1 user. | `alice@contoso.com` using the service |
| **Enterprise Customer's C2 User (Authenticated)** | Enterprise customer's customers. If Contoso uses services to maintain a relationship with Fabrikam, Fabrikam users are C2 users. Use when data can be associated with an authenticated C2 user. | End users of a Builder's app (App Users) |
| **Enterprise Customer tenant (C1, e.g. Contoso)** | Enterprise customer data that cannot be associated with an authenticated C1 or C2 user. Use for unauthenticated customer content stored by Microsoft (HOBO). | Contoso's organizational data stored in HOBO subscription |
| **Tenant Admin (C1 admin)** | Administrator of an enterprise customer's tenant. | Contoso's IT admin managing Fabric workspace |
| **Microsoft Employee** | Full-time or part-time Microsoft employees on Microsoft payroll. | `johndoe@microsoft.com` |
| **External Staff** | Workers not employed by Microsoft who have access to Microsoft's facilities and/or corporate network. | Agency temps, outsourced staff, contractors |
| **Student** | Students of an EDU tenant. | `student@university.edu` |
| **Public Person/Profile** | Data subject with a profile on a public source. | A user's public social media profile |

## Selection Guidance

- For **Fabric workloads**: Builders are typically C1 users; App Users of Builder apps are C2 users
- For **developer tools** (CLI, MCP): The developer is a C1 user
- For **telemetry**: If the event contains pseudonymous user identifiers (EUPI), the data subject is the C1 user whose identifier it is
- For **organizational data** (tenant IDs, workspace IDs): Leave data subject blank — OII is not personal data
- For **system metadata** (event names, durations, status codes): Leave data subject blank — not linkable to a user
