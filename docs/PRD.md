# PRD — Kubri Dashboard

**Project:** Kubri Dashboard (Web App for Organizations)
**Version:** 1.0 — Phase 1
**Date:** April 3, 2026
**Owner:** Kubri S.r.l. Società Benefit
**Authors:** Kubri Team (Giulia Mambrini, Giammarco Ubodi, Daniele La Ciura)

---

## 1. Context and Problem

Kubri is a multilingual AI virtual assistant that helps social cooperatives, employment agencies (APL), and public employment centers screen candidates for active labor policies — particularly entry-level profiles and people excluded from traditional channels (refugees, asylum seekers, workers with informal experience).

Today, the Kubri chatbot runs on Telegram via Make.com scenarios. Candidate data collected through interviews is stored in a Make.com Data Store (currently "test agent DB V4"). Organizations receive candidate profiles as static files (Excel/PDF exported to Google Drive), with no interface to browse, filter, or manage them.

### Current Problems

- **No interface for organizations:** profiles are delivered as static files, not browsable.
- **No filtering or search:** organizations cannot search candidates by skills, language, availability, or interview status.
- **No visibility on interview status:** incomplete interviews are tracked via a scheduled Make scenario, with no real-time visibility.
- **No multi-tenancy:** there is no data separation between different client organizations.
- **Manual export:** the process of generating PDF/Excel profiles is manual and fragmented.

---

## 2. Project Goal

Build a **web app dashboard** that allows Kubri's client organizations to:

1. View all candidate profiles collected by the chatbot
2. Filter and search candidates by relevant criteria
3. See interview status (completed, in progress, abandoned)
4. Export data in useful formats (CSV, PDF)
5. Manage their own workspace independently (multi-tenancy)

---

## 3. Target Users

| Persona | Role | Primary Need |
|---------|------|--------------|
| **HR Manager** (cooperative/APL) | Primary user | View candidates, filter by skills, export profiles |
| **Desk Operator** (employment center) | Operational user | Search candidates by language, availability, area |
| **Kubri Admin** | Internal management | Create organizations, monitor usage, manage configurations |

---

## 4. Functional Requirements — Phase 1 (MVP)

### 4.1 Authentication and Multi-tenancy

- Login with email + password (or magic link)
- Each organization has its own isolated workspace
- Roles: `admin_kubri` (superadmin), `org_admin` (organization admin), `org_member` (operator)
- A user belongs to one organization only

### 4.2 Candidate Profiles Dashboard

The main dashboard screen shows a **table/list of candidates** with:

| Field | Type | Notes |
|-------|------|-------|
| Name | text | Extracted from chatbot interview |
| Nationality | text | |
| Language(s) spoken | string array | Multilingual capability is a key Kubri feature |
| Skills | string array | Extracted from interview |
| Work experiences | structured text | Including informal ones |
| Availability | enum | Immediate / Within 1 month / Other |
| Area / City | text | |
| Interview status | enum | `completed` · `in_progress` · `abandoned` · `incomplete` |
| Interview date | datetime | |
| Channel | enum | `telegram` · `whatsapp` |
| Operator notes | text | Added manually by dashboard user |

### 4.3 Filters and Search

- **Full-text search** on name, skills, experiences
- **Combinable filters:**
  - Interview status
  - Language spoken
  - Nationality
  - Area/city
  - Availability
  - Date range
- **Sorting** by date, name, status
- **Saved filters** (nice-to-have Phase 1)

### 4.4 Candidate Detail

Clicking on a candidate opens a **detail page** with:

- All structured profile information
- Full chatbot interview transcript (question-answer pairs)
- Ability to add **internal operator notes**
- Ability to add **manual tags**
- **Export PDF** button for the individual profile

### 4.5 Export

- CSV export of the filtered list
- PDF export of individual profile (clean layout, ready to share)

### 4.6 Organization Management (org_admin)

- Invite new members (email)
- Remove members
- View basic stats: total candidates, completed vs incomplete interviews, weekly trend

### 4.7 Kubri Admin (superadmin)

- Create new organizations
- Assign an initial `org_admin`
- Global overview: number of organizations, total candidates, interviews per period

---

## 5. Non-Functional Requirements

- **Performance:** the table must load up to 10,000 profiles with server-side pagination without noticeable slowdowns
- **Security:** candidate data is sensitive (GDPR). Complete isolation between organizations. Encryption at rest and in transit
- **Responsive:** usable on tablets (desk operators often use tablets)
- **Accessibility:** WCAG 2.1 AA as target
- **UI language:** Italian for Phase 1, prepared for i18n (English in Phase 2)

---

## 6. Technical Architecture

### Hybrid Data Architecture

This is the most important architectural decision for Phase 1. The system uses a **hybrid approach** with two separate data stores:

| Data | Storage | Reason |
|------|---------|--------|
| Users, organizations, roles, invites, notes, tags, audit logs | **PostgreSQL** (own DB) | Business logic, auth, multi-tenancy |
| Candidate profiles, interview transcripts, flow control | **Make.com Data Store** | Source of truth — the chatbot writes here directly |

The Make.com Data Store (currently named "test agent DB V4") remains the **single source of truth** for all candidate data. The dashboard reads candidate data by calling the Make.com Data Store API. It does NOT duplicate or sync candidate records into PostgreSQL.

This means:

- **Reads:** the dashboard fetches candidate data from Make.com Data Store via API on every request (with caching)
- **Writes (candidate data):** only the chatbot writes candidate data, via Make scenarios
- **Writes (dashboard metadata):** notes, tags, and other dashboard-specific data live in PostgreSQL, linked to candidates via `make_record_id`
- **Filtering:** some filters run against Make.com API capabilities, others require fetching a broader dataset and filtering in the application layer

### Implications and Trade-offs

- **Latency:** Make.com API calls add latency. Caching (Redis or in-memory) is essential for acceptable UX
- **Filtering limitations:** Make.com Data Store API has limited query capabilities. Advanced filtering may require fetching a broader dataset and filtering application-side
- **Rate limits:** Make.com API has rate limits. The dashboard must handle these gracefully (retry, queue, cache)
- **Data consistency:** dashboard metadata (notes, tags) references Make records by ID. If a record is deleted in Make, orphaned references must be handled
- **Future migration:** this hybrid architecture is temporary. Phase 2 plans to migrate candidate data to PostgreSQL, at which point the Make.com Data Store becomes a write-through cache or is removed entirely

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14+ (App Router), React, TypeScript, Tailwind CSS |
| UI Components | shadcn/ui |
| State management | React Server Components + SWR/React Query for client state |
| Backend/API | Next.js API Routes (Route Handlers) |
| Database (business logic) | PostgreSQL (Supabase or Neon) |
| ORM | Prisma |
| Candidate data source | Make.com Data Store API |
| Auth | NextAuth.js (Auth.js v5) or Supabase Auth |
| Caching | Redis (Upstash) or in-memory LRU cache |
| File storage | Supabase Storage or S3 |
| PDF generation | @react-pdf/renderer or puppeteer |
| Hosting | Vercel |
| CI/CD | GitHub Actions → Vercel |

### Database Schema (PostgreSQL — business logic only)

```
Organization
  ├── id (uuid, PK)
  ├── name
  ├── slug (unique)
  ├── make_datastore_id (string — ID of the Make.com Data Store for this org)
  ├── make_api_token (encrypted string — Make.com API token)
  ├── created_at
  └── settings (jsonb)

User
  ├── id (uuid, PK)
  ├── email (unique)
  ├── name
  ├── role (enum: admin_kubri, org_admin, org_member)
  ├── organization_id (FK → Organization)
  ├── created_at
  └── last_login_at

CandidateNote
  ├── id (uuid, PK)
  ├── make_record_id (string — references candidate record in Make.com Data Store)
  ├── organization_id (FK → Organization)
  ├── user_id (FK → User)
  ├── content (text)
  └── created_at

CandidateTag
  ├── id (uuid, PK)
  ├── make_record_id (string)
  ├── organization_id (FK → Organization)
  ├── tag (string)
  └── created_at

AuditLog
  ├── id (uuid, PK)
  ├── user_id (FK → User)
  ├── organization_id (FK → Organization)
  ├── action (string)
  ├── resource_type (string)
  ├── resource_id (string)
  ├── metadata (jsonb)
  └── created_at
```

### Candidate Data Structure (in Make.com Data Store)

The candidate record in the Make.com Data Store has the following relevant fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Make.com internal record ID — used as `make_record_id` in PostgreSQL |
| `name` | string | Candidate's name |
| `nationality` | string | |
| `languages` | string/array | Languages spoken |
| `skills` | string/array | Skills extracted from interview |
| `work_experiences` | string/JSON | Work history, possibly informal |
| `availability` | string | |
| `city` | string | |
| `flow_control` | JSON | Tracks interview state, current step, completion status |
| `interview_transcript` | JSON | Full Q&A transcript |
| `channel` | string | `telegram` or `whatsapp` |
| `created_at` | datetime | |
| `updated_at` | datetime | |

> **Note:** the exact field names and structure must be mapped from the "test agent DB V4" Make Data Store. This mapping is a critical task in Week 1.

### Data Flow

```
┌──────────────┐     writes      ┌──────────────────────┐
│  Telegram     │ ──────────────→ │  Make.com Data Store  │
│  Chatbot      │   (via Make     │  (candidate records)  │
│  (candidate)  │    scenarios)   │                       │
└──────────────┘                 └──────────┬───────────┘
                                            │ reads (API)
                                            ▼
                                 ┌──────────────────────┐
                                 │   Kubri Dashboard     │
                                 │   (Next.js app)       │
                                 │                       │
                                 │   reads/writes        │
                                 │        ↕              │
                                 │   PostgreSQL          │
                                 │   (users, orgs,       │
                                 │    notes, tags)       │
                                 └──────────────────────┘
```

---

## 7. Make.com Data Store API Integration

### Authentication

Make.com API uses an API token for authentication. Each organization's token is stored encrypted in the `Organization` table.

### Key Endpoints

- `GET /datastores/{datastore_id}/data` — list records (paginated)
- `GET /datastores/{datastore_id}/data/{record_id}` — get single record
- Search/filter capabilities depend on Make.com API support

### Caching Strategy

| Data | Cache TTL | Invalidation |
|------|-----------|-------------|
| Candidate list (paginated) | 60 seconds | Manual refresh button in UI |
| Single candidate detail | 30 seconds | On page load |
| Organization metadata | 5 minutes | On settings change |

### Error Handling

- **Rate limit exceeded:** queue and retry with exponential backoff, show "loading" state to user
- **Make.com API down:** show cached data with "data may be stale" banner
- **Record not found:** handle gracefully, mark orphaned notes/tags

---

## 8. Page Structure

```
/login                          → Login
/dashboard                      → Redirect to /dashboard/candidates
/dashboard/candidates           → Candidates table with filters
/dashboard/candidates/[id]      → Candidate detail (id = make_record_id)
/dashboard/settings             → Organization settings
/dashboard/settings/members     → Member management
/dashboard/stats                → Basic statistics
/admin                          → Kubri admin panel (admin_kubri only)
/admin/organizations            → Organizations list
/admin/organizations/[id]       → Organization detail
```

---

## 9. Phases and Milestones

### Phase 1 — MVP (6-8 weeks)

| Week | Deliverable |
|------|------------|
| 1 | Project setup, DB schema, auth, Make.com Data Store field mapping |
| 2 | Make.com API integration layer, caching, data normalization |
| 3-4 | Candidates table, filters, search, pagination |
| 5 | Candidate detail, notes, tags |
| 6 | CSV/PDF export |
| 7 | Organization management, member invites |
| 8 | Testing, bug fixes, production deploy |

### Phase 2 — Post-MVP

- Migrate candidate data from Make.com Data Store to PostgreSQL (eliminate hybrid architecture)
- Migrate chatbot from Make to custom Node.js code
- WhatsApp Business API integration
- Advanced statistics dashboard (charts, trends, funnel)
- Interview question configuration from the dashboard
- i18n (English UI)
- Notifications (new completed interview, abandoned interview)
- Saved filters and custom views

### Phase 3 — Scale

- Public API for ATS integrations
- AI-powered candidate-position matching
- Mobile app for operators
- White-label for large organizations

---

## 10. Success Metrics (Phase 1)

| Metric | Target |
|--------|--------|
| Time to find a specific candidate | < 30 seconds (vs minutes on Excel) |
| Adoption by pilot organizations | 2-3 active organizations |
| Interviews viewable in dashboard | 100% of completed interviews |
| Uptime | > 99.5% |

---

## 11. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Make.com Data Store API limitations (filtering, rate limits) | High | Caching layer, application-level filtering, plan migration to own DB in Phase 2 |
| Data structure inconsistency in Make Data Store | High | Strict normalization layer at API integration level, handle missing/malformed fields gracefully |
| GDPR and sensitive candidate data | High | Multi-tenant isolation, audit logs, encryption, DPA with cloud providers |
| Slow adoption by organizations | Medium | Guided onboarding, simple interface, tight feedback loop |
| Make.com API downtime affects dashboard | Medium | Cache layer provides stale-but-available data, clear UX communication |
| Latency from Make.com API calls | Medium | Aggressive caching, optimistic UI updates, background refresh |

---

## 12. Open Decisions

- [ ] **Auth provider:** NextAuth.js vs Supabase Auth — decide based on chosen DB provider
- [ ] **DB hosting:** Supabase vs Neon — evaluate costs and EU latency
- [ ] **Caching:** Redis (Upstash) vs in-memory LRU — depends on Vercel plan and data volume
- [ ] **Make.com Data Store field mapping:** exact field names and types from "test agent DB V4" need to be documented
- [ ] **Make.com API rate limits:** need to test and document actual limits for the plan in use
- [ ] **Multi-org on Make.com:** clarify if each organization has its own Data Store or if they share one with an org identifier field
