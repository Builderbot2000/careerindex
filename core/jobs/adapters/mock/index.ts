import { BaseAdapter } from '../base'
import type { JobPosting, SearchFilters, Seniority, CrawlSignal } from '../base'

const MOD_VERSION = '0.2.0-mock'
const SOURCE = 'mock'

// 120ms per result in dev; 100ms in test (enough for Pause/Stop interaction tests)
const CRAWL_DELAY_MS = process.env.APP_TEST === '1' ? 100 : 120

// How many results to return per crawl (simulates a page of results)
const RESULTS_PER_CRAWL_MIN = 15
const RESULTS_PER_CRAWL_MAX = 25

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const BASE_FIELDS = {
  resolved_domain: null,
  applicant_count: null,
  scraper_mod_version: MOD_VERSION,
  source: SOURCE,
  status: 'new' as const,
  affinity_score: null,
  affinity_skipped: false,
  affinity_scored_at: null,
  affinity_reasoning: null,
  description_snippet: null,
  hard_reqs_class: null,
  nice_to_haves_class: null,
  first_response_at: null,
  salary_min: null,
  salary_max: null,
  company_rating: null,
}

function p(
  n: number,
  title: string,
  company: string,
  location: string,
  yoe_min: number | null,
  yoe_max: number | null,
  seniority: Seniority,
  tech_stack: string[],
  daysOffset: number,
  raw_text: string,
): Omit<JobPosting, 'id'> {
  return {
    ...BASE_FIELDS,
    url: `https://news.ycombinator.com/item?id=3900${String(n).padStart(4, '0')}`,
    title,
    company,
    location,
    yoe_min,
    yoe_max,
    seniority,
    tech_stack,
    posted_at: daysAgo(daysOffset),
    fetched_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    raw_text,
  }
}

// ─── Reserve pool (120 postings) ──────────────────────────────────────────────

const MOCK_POOL: Omit<JobPosting, 'id'>[] = [
  p(1, 'Senior Backend Engineer', 'Stripe', 'remote', 5, null, 'senior', ['Go', 'Ruby', 'PostgreSQL', 'Kubernetes'], 1,
    `Stripe is hiring a Senior Backend Engineer for Payments Infrastructure. You will design systems that process billions of dollars in transactions annually.\n\nResponsibilities:\n- Build fault-tolerant distributed systems at 10K+ TPS\n- Own reliability of core payment flows end to end\n- Drive cross-team architecture decisions\n\nRequirements:\n- 5+ years backend engineering\n- Strong distributed systems knowledge\n- Experience with Go or Ruby at scale\n- Kubernetes and PostgreSQL expertise\n\nRemote-friendly. Offices in SF, Seattle, NYC, Dublin.`),

  p(2, 'Staff Software Engineer, Infrastructure', 'Vercel', 'remote', 8, null, 'staff', ['TypeScript', 'Rust', 'Next.js', 'AWS'], 2,
    `Vercel is looking for a Staff Software Engineer on the Infrastructure team to define the architecture of our global edge network.\n\nYou will:\n- Lead technical direction for the edge compute platform\n- Design systems for low-latency global request routing\n- Mentor senior engineers and drive cross-team initiatives\n\nRequirements:\n- 8+ years engineering with a systems background\n- Deep knowledge of network protocols and edge computing\n- Experience with Rust or C++ for performance-critical paths\n\nFully remote.`),

  p(3, 'Software Engineer, Frontend', 'Linear', 'remote', 3, 6, 'mid', ['TypeScript', 'React', 'GraphQL'], 3,
    `Linear is building the issue tracker that developers actually want to use. We're hiring a Frontend Engineer to work on the core product.\n\nWhat you'll work on:\n- Real-time collaborative editing and sync\n- High-performance list and graph views\n- Keyboard-driven interaction patterns\n\nRequirements:\n- 3+ years React and TypeScript\n- Strong eye for polish and performance\n- Familiarity with GraphQL and WebSockets\n\nRemote. Small team, high impact.`),

  p(4, 'Senior Full-Stack Engineer', 'Figma', 'hybrid — New York, NY', 5, null, 'senior', ['TypeScript', 'React', 'Python', 'WebAssembly'], 4,
    `Figma is looking for a Senior Full-Stack Engineer to work on collaborative editing infrastructure.\n\nResponsibilities:\n- Build the web and server layers powering real-time multiplayer design\n- Improve performance and reliability of the Figma web editor\n\nRequirements:\n- 5+ years full-stack (TypeScript, Python or similar)\n- Strong understanding of browser rendering and performance\n- Experience with WebAssembly a plus\n\nHybrid — NYC office 3 days/week.`),

  p(5, 'Senior Platform Engineer', 'Fly.io', 'remote', 5, null, 'senior', ['Go', 'Rust', 'Nix', 'Linux'], 5,
    `Fly.io runs applications close to users around the world. We need a Senior Platform Engineer for the systems orchestrating thousands of Firecracker VMs.\n\nYou'll:\n- Build and maintain the control plane that manages VM lifecycle\n- Work on low-level networking (WireGuard, BGP, anycast)\n\nRequirements:\n- 5+ years systems programming (Go, Rust, or C)\n- Deep Linux internals knowledge (namespaces, cgroups)\n- Experience with distributed systems orchestration\n\nFully remote. Async-first culture.`),

  p(6, 'Senior Software Engineer, Site Reliability', 'GitHub', 'remote', 5, null, 'senior', ['Go', 'Ruby', 'Kubernetes', 'Prometheus'], 7,
    `GitHub is looking for a Senior SRE to keep GitHub.com available for 100M+ developers.\n\nResponsibilities:\n- Own availability and latency SLOs for critical platform services\n- Build tooling and automation to reduce toil at scale\n- Drive incident response and postmortem culture\n\nRequirements:\n- 5+ years SRE or platform engineering\n- Strong proficiency in Go or Ruby\n- Deep Kubernetes operational experience\n\nRemote-first.`),

  p(7, 'Senior Backend Engineer', 'Shopify', 'remote', 5, null, 'senior', ['Ruby', 'Go', 'GraphQL', 'MySQL'], 8,
    `Shopify is hiring a Senior Backend Engineer to scale the commerce platform powering 2M+ merchants.\n\nWhat you'll do:\n- Build and scale APIs serving billions of requests per month\n- Design for multi-tenancy and extreme traffic spikes (BFCM)\n\nRequirements:\n- 5+ years backend, deep Ruby on Rails experience\n- Familiarity with Go for performance-critical services\n- MySQL at scale experience\n\nRemote-first globally.`),

  p(8, 'Backend Engineer', 'Discord', 'remote', 3, 6, 'mid', ['Python', 'Rust', 'Elixir', 'Cassandra'], 10,
    `Discord is hiring a Backend Engineer for the messaging infrastructure serving 500M registered users.\n\nResponsibilities:\n- Build low-latency message delivery pipelines\n- Work across Python, Elixir, and Rust service boundaries\n- Improve scalability of our Cassandra-backed storage\n\nRequirements:\n- 3+ years backend engineering\n- Experience with Python, Elixir, or Rust\n- Comfort with distributed systems and eventual consistency\n\nRemote-eligible (US).`),

  p(9, 'Staff Engineer, Database Platform', 'PlanetScale', 'remote', 8, null, 'staff', ['Go', 'MySQL', 'Kubernetes', 'Vitess'], 12,
    `PlanetScale is looking for a Staff Engineer to lead development on the core database engine.\n\nYou will:\n- Lead architecture decisions on the Vitess-based sharding layer\n- Drive reliability and performance improvements\n- Partner with customers on complex schema optimisation\n\nRequirements:\n- 8+ years with databases or distributed systems\n- Deep MySQL and/or Vitess internals knowledge\n- Strong Go engineering skills\n\nFully remote.`),

  p(10, 'Senior Frontend Engineer', 'Notion', 'hybrid — San Francisco, CA', 5, null, 'senior', ['TypeScript', 'React', 'Next.js', 'PostgreSQL'], 13,
    `Notion is hiring a Senior Frontend Engineer to work on the collaborative editor used by millions.\n\nResponsibilities:\n- Architect and build the block-based collaborative editor\n- Work on rendering performance for large, complex documents\n\nRequirements:\n- 5+ years React and TypeScript\n- Deep browser performance knowledge\n- Experience with collaborative or rich-text editing a strong plus\n\nHybrid in SF — 3 days/week.`),

  p(11, 'Backend Engineer', 'Supabase', 'remote', 3, 7, 'mid', ['TypeScript', 'Go', 'PostgreSQL', 'Rust'], 15,
    `Supabase is building the open source Firebase alternative. We're looking for a Backend Engineer to work on the platform.\n\nWhat you'll work on:\n- PostgREST integration and auto-generated API layer\n- Realtime subscription engine\n- Database branching and migration tooling\n\nRequirements:\n- 3+ years backend engineering\n- Deep PostgreSQL knowledge (extensions, RLS, triggers)\n- Experience with TypeScript or Go\n\nFully remote, async-first.`),

  p(12, 'Senior Software Engineer', 'Deno', 'remote', 5, null, 'senior', ['TypeScript', 'Rust', 'V8', 'WebAssembly'], 17,
    `Deno is hiring a Senior Software Engineer for the runtime, standard library, and Deno Deploy.\n\nYou'll:\n- Contribute to the Deno runtime (Rust + V8)\n- Design TypeScript APIs and standard library modules\n- Work on Deno Deploy serverless TypeScript execution\n\nRequirements:\n- 5+ years software engineering\n- Strong Rust or C++ systems programming\n- Deep understanding of JavaScript/TypeScript runtimes\n\nRemote. Small tight-knit team.`),

  p(13, 'Full-Stack Engineer', 'Railway', 'remote', 2, 5, 'mid', ['TypeScript', 'React', 'Go', 'PostgreSQL'], 20,
    `Railway makes deployment so easy it gets out of your way. Hiring a Full-Stack Engineer for the dashboard, CLI, and infrastructure API.\n\nResponsibilities:\n- Build the Railway dashboard and CLI in TypeScript\n- Work on the Go-based infrastructure orchestration API\n\nRequirements:\n- 2+ years full-stack engineering\n- Proficiency in TypeScript/React for frontend\n- Comfortable with Go or similar for backend\n\nFully remote. Early-stage startup.`),

  p(14, 'Senior Backend Engineer', 'Loom', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Python', 'Go', 'PostgreSQL', 'AWS'], 22,
    `Loom is hiring a Senior Backend Engineer to scale the video processing and delivery infrastructure.\n\nResponsibilities:\n- Own the video ingestion, transcoding, and delivery pipeline\n- Collaborate with ML team on AI-powered video features\n\nRequirements:\n- 5+ years backend (Python and/or Go)\n- Experience with video processing or media infrastructure a plus\n- Deep AWS services knowledge\n\nHybrid in SF.`),

  p(15, 'Senior Software Engineer', 'Airbnb', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Java', 'Ruby', 'React', 'Kafka'], 25,
    `Airbnb is hiring a Senior Software Engineer for the core marketplace and payments platform.\n\nWhat you'll do:\n- Build and scale microservices powering search, booking, and payments\n- Drive technical excellence through design reviews and mentorship\n\nRequirements:\n- 5+ years software engineering\n- Proficiency in Java or Ruby\n- Experience with event-driven architectures (Kafka)\n\nHybrid in SF.`),

  p(16, 'Senior Data Engineer', 'Databricks', 'remote', 5, null, 'senior', ['Python', 'Spark', 'Scala', 'Delta Lake'], 1,
    `Databricks is hiring a Senior Data Engineer to build the data platform that powers our lakehouse.\n\nResponsibilities:\n- Design and implement large-scale ETL pipelines on Spark\n- Build infrastructure for the Delta Lake ecosystem\n- Partner with ML teams on feature engineering pipelines\n\nRequirements:\n- 5+ years data engineering\n- Deep Apache Spark and distributed computing experience\n- Strong Python and Scala skills\n- Familiarity with Delta Lake or similar open table formats\n\nRemote-friendly.`),

  p(17, 'ML Engineer', 'Anthropic', 'remote', 5, null, 'senior', ['Python', 'PyTorch', 'CUDA', 'JAX'], 2,
    `Anthropic is building AI systems that are safe, beneficial, and understandable. We're hiring an ML Engineer to work on training infrastructure and model research.\n\nResponsibilities:\n- Design and implement distributed training pipelines\n- Optimize GPU utilization for large-scale model training\n- Work closely with research scientists on experimental runs\n\nRequirements:\n- 5+ years ML engineering experience\n- Deep expertise in PyTorch and CUDA optimization\n- Experience with large-scale distributed training\n- Strong Python engineering fundamentals\n\nRemote or San Francisco.`),

  p(18, 'Senior Software Engineer', 'Cloudflare', 'remote', 5, null, 'senior', ['Rust', 'TypeScript', 'Go', 'C'], 3,
    `Cloudflare is building the network layer of the future. We're hiring a Senior Engineer to work on the Cloudflare Workers runtime and edge platform.\n\nResponsibilities:\n- Extend and optimize the V8-based Workers runtime\n- Build low-level networking and proxying infrastructure\n- Improve performance and reliability of the global edge network\n\nRequirements:\n- 5+ years systems engineering\n- Strong Rust, Go, or C experience\n- Understanding of HTTP, TCP/IP, and TLS internals\n- Experience with WebAssembly a strong plus\n\nFully remote.`),

  p(19, 'Full-Stack Engineer', 'Convex', 'remote', 3, 6, 'mid', ['TypeScript', 'React', 'Rust'], 4,
    `Convex is the reactive backend platform for TypeScript developers. We're hiring a Full-Stack Engineer to work on the developer experience and dashboard.\n\nWhat you'll work on:\n- The Convex dashboard and web console\n- Client SDKs and developer tooling\n- Documentation infrastructure and examples\n\nRequirements:\n- 3+ years TypeScript and React\n- Strong product intuition and attention to UX detail\n- Interest in developer tools and backend infrastructure\n\nFully remote.`),

  p(20, 'Senior Backend Engineer', 'Temporal', 'remote', 5, null, 'senior', ['Go', 'Java', 'gRPC', 'Cassandra'], 5,
    `Temporal is the open source workflow orchestration platform. We're hiring a Senior Backend Engineer to work on the core server and SDK ecosystem.\n\nResponsibilities:\n- Improve durability, scalability, and performance of the Temporal server\n- Build out Go and Java SDK features\n- Partner with customers on integration patterns\n\nRequirements:\n- 5+ years backend engineering\n- Strong Go or Java experience\n- Experience with distributed systems and workflow engines\n- Familiarity with Cassandra or similar NoSQL stores\n\nRemote.`),

  p(21, 'Software Engineer', 'Apple', 'on-site — Cupertino, CA', 3, 6, 'mid', ['Swift', 'C++', 'Objective-C', 'LLVM'], 6,
    `Apple is hiring a Software Engineer for the Xcode and developer tools team. You will work on the IDE and build toolchain used by millions of developers worldwide.\n\nResponsibilities:\n- Build and maintain core Xcode features and editor infrastructure\n- Contribute to the Swift and LLVM compiler toolchain\n- Collaborate with platform teams across Apple\n\nRequirements:\n- 3+ years software engineering\n- Proficiency in Swift and/or C++\n- Experience with compilers, IDEs, or developer tools a strong plus\n\nOn-site in Cupertino.`),

  p(22, 'Senior Frontend Engineer', 'Tailwind Labs', 'remote', 5, null, 'senior', ['TypeScript', 'React', 'CSS', 'Node.js'], 7,
    `Tailwind Labs is looking for a Senior Frontend Engineer to help build Tailwind UI, Headless UI, and the broader component ecosystem.\n\nWhat you'll work on:\n- Component design and implementation for Tailwind UI\n- Accessibility and cross-browser compatibility\n- Documentation and example apps\n\nRequirements:\n- 5+ years frontend engineering\n- Expert-level CSS and TypeScript\n- Deep understanding of accessibility (WCAG)\n- Strong design sensibility\n\nFully remote, async-first.`),

  p(23, 'Platform Engineer', 'Render', 'remote', 3, 5, 'mid', ['Go', 'Kubernetes', 'Docker', 'PostgreSQL'], 8,
    `Render is the cloud for modern developers. We're hiring a Platform Engineer to work on the container orchestration and routing layer.\n\nResponsibilities:\n- Build and operate the container scheduling and runtime platform\n- Improve multi-region networking and routing\n- Develop internal tooling for platform observability\n\nRequirements:\n- 3+ years platform or backend engineering\n- Strong Go development skills\n- Kubernetes operational experience\n- Understanding of container networking and cgroups\n\nFully remote.`),

  p(24, 'Senior Site Reliability Engineer', 'Google', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Go', 'Python', 'Borg', 'Spanner'], 9,
    `Google SRE is responsible for the availability, latency, and efficiency of Google's production systems. We're hiring a Senior SRE for the Cloud Infrastructure team.\n\nResponsibilities:\n- Define and enforce SLOs across large-scale distributed services\n- Lead incident response and drive postmortem culture\n- Build automation to reduce operational toil\n\nRequirements:\n- 5+ years SRE or software engineering\n- Proficiency in Go or Python\n- Experience managing large-scale distributed systems\n- Familiarity with Google's internal tooling (Borg, Spanner) a plus\n\nHybrid in SF.`),

  p(25, 'Staff Software Engineer', 'Meta', 'hybrid — Seattle, WA', 8, null, 'staff', ['Python', 'C++', 'Hack', 'React'], 11,
    `Meta is hiring a Staff Software Engineer for the Infrastructure Foundations team.\n\nYou will:\n- Define technical roadmap for large-scale infrastructure systems\n- Drive cross-org engineering initiatives\n- Mentor staff and senior engineers across teams\n\nRequirements:\n- 8+ years software engineering\n- Proven track record of leading large-scale technical projects\n- Deep expertise in systems programming (C++) or large-scale services (Python)\n- Experience with Meta-scale infrastructure a plus\n\nHybrid in Seattle.`),

  p(26, 'Backend Engineer', 'Neon', 'remote', 3, 6, 'mid', ['Rust', 'PostgreSQL', 'S3', 'Linux'], 12,
    `Neon is building a serverless PostgreSQL platform with branching and instant provisioning. We're hiring a Backend Engineer to work on the storage engine.\n\nWhat you'll work on:\n- The Neon storage engine (Rust + PostgreSQL internals)\n- Copy-on-write storage layer backed by S3\n- Database branching and point-in-time recovery\n\nRequirements:\n- 3+ years systems engineering\n- Strong Rust skills\n- PostgreSQL internals or storage systems experience a strong plus\n\nFully remote.`),

  p(27, 'Senior Software Engineer', '1Password', 'remote', 5, null, 'senior', ['Go', 'TypeScript', 'Rust', 'Swift'], 13,
    `1Password is hiring a Senior Software Engineer to help build and secure the world's most trusted password manager.\n\nResponsibilities:\n- Build secure, cross-platform cryptographic systems\n- Work on the Go-based backend and TypeScript frontend\n- Drive security-first engineering practices\n\nRequirements:\n- 5+ years software engineering\n- Experience with applied cryptography or security-critical systems\n- Proficiency in Go and/or TypeScript\n- Security mindset in all engineering decisions\n\nFully remote.`),

  p(28, 'Software Engineer II', 'Amazon', 'hybrid — Seattle, WA', 3, 6, 'mid', ['Java', 'Kotlin', 'AWS', 'DynamoDB'], 14,
    `Amazon AWS is hiring a Software Engineer II to work on core cloud services infrastructure.\n\nResponsibilities:\n- Design and build distributed systems powering AWS services\n- Operate high-traffic, high-reliability production systems\n- Participate in on-call and drive operational excellence\n\nRequirements:\n- 3+ years software engineering\n- Proficiency in Java or Kotlin\n- Experience with AWS services (DynamoDB, SQS, S3)\n- Strong distributed systems fundamentals\n\nHybrid in Seattle.`),

  p(29, 'Principal Engineer', 'Netflix', 'hybrid — Los Gatos, CA', 10, null, 'staff', ['Java', 'Kotlin', 'AWS', 'Kafka'], 16,
    `Netflix is hiring a Principal Engineer to help define the technical direction of the Content Delivery and Streaming platform.\n\nYou will:\n- Set architecture direction for global CDN and streaming infrastructure\n- Drive technical strategy across multiple engineering teams\n- Represent technical direction in executive-level planning\n\nRequirements:\n- 10+ years engineering with demonstrated principal-level impact\n- Deep expertise in CDN, streaming, or large-scale distributed systems\n- Track record of cross-org technical leadership\n\nHybrid in Los Gatos.`),

  p(30, 'Senior Backend Engineer', 'Grafana Labs', 'remote', 5, null, 'senior', ['Go', 'Prometheus', 'Grafana', 'Kubernetes'], 18,
    `Grafana Labs is hiring a Senior Backend Engineer to work on the Grafana observability platform.\n\nResponsibilities:\n- Build and scale the Grafana backend and data source integrations\n- Improve query performance for large-scale Prometheus and Loki datasets\n- Contribute to open source Grafana projects\n\nRequirements:\n- 5+ years backend engineering in Go\n- Familiarity with Prometheus, Loki, or Tempo\n- Experience operating Kubernetes at scale\n\nFully remote.`),

  p(31, 'Full-Stack Engineer', 'Prisma', 'remote', 2, 5, 'mid', ['TypeScript', 'Rust', 'Node.js', 'PostgreSQL'], 20,
    `Prisma is building the data layer for modern application development. We're hiring a Full-Stack Engineer to work on the Prisma ORM and tooling ecosystem.\n\nWhat you'll work on:\n- Prisma Client code generation and query engine\n- Developer experience for the VS Code extension and CLI\n- Documentation infrastructure\n\nRequirements:\n- 2+ years TypeScript and Node.js\n- Interest in developer tooling and language tooling\n- Familiarity with SQL databases and ORMs\n\nFully remote.`),

  p(32, 'Senior Software Engineer', 'Oxide Computer', 'on-site — San Francisco, CA', 5, null, 'senior', ['Rust', 'illumos', 'FPGA', 'C'], 21,
    `Oxide Computer is building the world's first commercial cloud computer. We're hiring a Senior Software Engineer for the systems software stack.\n\nYou'll work on:\n- The host OS (illumos-based) and hypervisor\n- Firmware and embedded Rust for control plane hardware\n- Distributed control plane services\n\nRequirements:\n- 5+ years systems engineering\n- Expert Rust and/or C skills\n- Experience with OS internals, hypervisors, or embedded systems\n\nOn-site in San Francisco.`),

  p(33, 'Software Engineer', 'Replicate', 'remote', 3, 6, 'mid', ['Python', 'Go', 'CUDA', 'Docker'], 23,
    `Replicate makes it easy to run machine learning models in the cloud. We're hiring a Software Engineer to work on the model serving and infrastructure platform.\n\nResponsibilities:\n- Build the container runtime for ML model inference\n- Optimize GPU scheduling and utilization\n- Improve the developer experience for model deployment\n\nRequirements:\n- 3+ years backend engineering\n- Experience with Docker and container runtimes\n- Familiarity with GPU computing and CUDA a strong plus\n\nRemote.`),

  p(34, 'Senior Full-Stack Engineer', 'Clerk', 'remote', 4, null, 'senior', ['TypeScript', 'React', 'Next.js', 'Go'], 25,
    `Clerk is the authentication and user management platform for modern applications. We're hiring a Senior Full-Stack Engineer.\n\nWhat you'll build:\n- SDKs and components used by hundreds of thousands of developers\n- The Clerk dashboard and admin console\n- Auth infrastructure and session management\n\nRequirements:\n- 4+ years TypeScript and React\n- Experience building developer-facing products (SDKs, APIs)\n- Understanding of auth protocols (OAuth, OIDC, JWT)\n\nFully remote.`),

  p(35, 'Backend Engineer', 'Resend', 'remote', 2, 5, 'mid', ['TypeScript', 'Node.js', 'Go', 'PostgreSQL'], 27,
    `Resend is the email API for developers. We're hiring a Backend Engineer to work on deliverability infrastructure and the developer-facing API.\n\nWhat you'll work on:\n- Email sending, queueing, and deliverability infrastructure\n- Webhook delivery and event processing\n- API design and SDK development\n\nRequirements:\n- 2+ years backend engineering\n- Strong TypeScript and Node.js skills\n- Experience with email protocols (SMTP, DKIM, SPF) a plus\n\nRemote.`),

  p(36, 'Senior Software Engineer', 'Microsoft', 'hybrid — Redmond, WA', 5, null, 'senior', ['C#', 'TypeScript', 'Azure', '.NET'], 2,
    `Microsoft is hiring a Senior Software Engineer for the Azure Developer Tools team.\n\nResponsibilities:\n- Build developer tools and services on the Azure platform\n- Work on VS Code extensions and developer productivity features\n- Collaborate with open source communities\n\nRequirements:\n- 5+ years software engineering\n- Strong C# and TypeScript skills\n- Experience building cloud-native applications on Azure\n\nHybrid in Redmond.`),

  p(37, 'Staff Engineer', 'Shopify', 'remote', 8, null, 'staff', ['Ruby', 'Go', 'MySQL', 'Kafka'], 3,
    `Shopify is hiring a Staff Engineer to lead technical direction for the core platform team.\n\nYou will:\n- Define the technical roadmap for high-impact platform components\n- Lead cross-team design reviews and architectural decisions\n- Mentor and grow senior engineers\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Deep Ruby on Rails and Go experience\n- Experience scaling systems under extreme Black Friday loads\n\nRemote-first.`),

  p(38, 'Senior Software Engineer', 'Warp', 'remote', 5, null, 'senior', ['Rust', 'TypeScript', 'WebGPU'], 4,
    `Warp is the terminal that works like a modern app. We're hiring a Senior Engineer to work on the Rust-based terminal rendering engine.\n\nResponsibilities:\n- Build and optimize the GPU-accelerated terminal renderer\n- Work on AI-powered shell features\n- Improve cross-platform compatibility (macOS, Linux, Windows)\n\nRequirements:\n- 5+ years systems engineering\n- Expert Rust skills\n- Experience with GPU rendering (Metal, WebGPU, or OpenGL) a plus\n\nRemote.`),

  p(39, 'Software Engineer', 'Turso', 'remote', 3, 5, 'mid', ['Rust', 'SQLite', 'TypeScript', 'Wasm'], 5,
    `Turso is building the edge database built on libSQL (a fork of SQLite). We're hiring a Software Engineer to work on the core database engine.\n\nWhat you'll work on:\n- libSQL server and replication protocol\n- Edge database deployment and consistency primitives\n- Client SDKs for TypeScript, Python, and Rust\n\nRequirements:\n- 3+ years systems or backend engineering\n- Experience with databases or storage systems\n- Strong Rust skills preferred\n\nFully remote.`),

  p(40, 'Senior Mobile Engineer', 'Linear', 'remote', 5, null, 'senior', ['Swift', 'Kotlin', 'TypeScript', 'React Native'], 6,
    `Linear is hiring a Senior Mobile Engineer to work on the iOS and Android apps.\n\nResponsibilities:\n- Build and polish the native Linear apps for iOS and Android\n- Implement real-time sync and offline support\n- Work closely with the design team on interactions and animations\n\nRequirements:\n- 5+ years mobile engineering (Swift and/or Kotlin)\n- Experience with offline-first data sync\n- Strong attention to UI detail and performance\n\nRemote.`),

  p(41, 'Senior Backend Engineer', 'PagerDuty', 'remote', 5, null, 'senior', ['Go', 'Kafka', 'PostgreSQL', 'Kubernetes'], 7,
    `PagerDuty is hiring a Senior Backend Engineer to work on the alert routing and on-call management platform.\n\nResponsibilities:\n- Build high-throughput event ingestion and routing pipelines\n- Improve reliability and scalability of the alerting infrastructure\n- Work on integrations with hundreds of monitoring tools\n\nRequirements:\n- 5+ years backend engineering\n- Strong Go skills\n- Experience with Kafka or similar event streaming platforms\n- Comfort with Kubernetes and cloud infrastructure\n\nRemote.`),

  p(42, 'Software Engineer', 'Modal', 'remote', 2, 5, 'mid', ['Python', 'Go', 'gVisor', 'CUDA'], 8,
    `Modal is the cloud platform for running ML workloads. We're hiring a Software Engineer to work on the container and serverless runtime.\n\nResponsibilities:\n- Build the container orchestration and scheduling layer\n- Optimize GPU-attached container startup latency\n- Work on the Python client SDK\n\nRequirements:\n- 2+ years backend engineering\n- Strong Python skills\n- Interest in cloud infrastructure and serverless systems\n- Experience with containers and Linux namespaces a plus\n\nRemote.`),

  p(43, 'Staff Site Reliability Engineer', 'GitHub', 'remote', 8, null, 'staff', ['Go', 'Ruby', 'Kubernetes', 'Terraform'], 10,
    `GitHub is hiring a Staff SRE to lead reliability engineering for core platform services.\n\nYou will:\n- Define reliability standards and SLO frameworks for the platform\n- Lead complex incident response and systemic reliability initiatives\n- Partner with engineering leadership on reliability roadmap\n\nRequirements:\n- 8+ years SRE or platform engineering\n- Deep Kubernetes and cloud infrastructure expertise\n- Experience leading org-wide reliability initiatives\n\nRemote-first.`),

  p(44, 'Senior Software Engineer', 'Zed', 'remote', 5, null, 'senior', ['Rust', 'GPUI', 'Tree-sitter'], 11,
    `Zed is building the world's fastest code editor. We're hiring a Senior Software Engineer to work on the editor core and language tooling.\n\nResponsibilities:\n- Extend the GPUI GPU-accelerated UI framework\n- Build language server integrations and Tree-sitter grammars\n- Improve collaboration and real-time editing features\n\nRequirements:\n- 5+ years engineering with deep Rust expertise\n- Experience building text editors, IDEs, or UI frameworks\n- Understanding of language server protocol (LSP)\n\nRemote.`),

  p(45, 'Full-Stack Engineer', 'Val.town', 'remote', 3, 5, 'mid', ['TypeScript', 'Deno', 'PostgreSQL', 'React'], 13,
    `Val.town is the social code platform where you write and deploy code in the browser. We're hiring a Full-Stack Engineer.\n\nWhat you'll work on:\n- The code editor and sandbox runtime\n- User profiles, social feeds, and collaboration features\n- Serverless execution infrastructure on Deno\n\nRequirements:\n- 3+ years TypeScript and full-stack experience\n- Interest in programming tools and sandboxed execution environments\n\nRemote. Early-stage team.`),

  p(46, 'Senior Backend Engineer', 'Plaid', 'remote', 5, null, 'senior', ['Python', 'Go', 'PostgreSQL', 'Kafka'], 14,
    `Plaid connects financial institutions to applications. We're hiring a Senior Backend Engineer for the core connectivity platform.\n\nResponsibilities:\n- Build and scale financial data aggregation pipelines\n- Maintain integrations with thousands of financial institutions\n- Improve reliability and compliance infrastructure\n\nRequirements:\n- 5+ years backend engineering\n- Experience with Python and/or Go\n- Familiarity with financial data and compliance requirements a plus\n\nRemote.`),

  p(47, 'Software Engineer', 'Inngest', 'remote', 2, 5, 'mid', ['TypeScript', 'Go', 'React', 'PostgreSQL'], 16,
    `Inngest is the event-driven job queue and workflow platform for developers. We're hiring a Software Engineer to work on the platform and SDK.\n\nWhat you'll work on:\n- The TypeScript and Go SDK ecosystem\n- Event ingestion and workflow execution engine\n- The developer dashboard and observability UI\n\nRequirements:\n- 2+ years TypeScript and/or Go experience\n- Interest in workflow engines and developer tooling\n\nRemote.`),

  p(48, 'Senior Software Engineer', 'Tailscale', 'remote', 5, null, 'senior', ['Go', 'WireGuard', 'Linux', 'Networking'], 18,
    `Tailscale is building the zero-config WireGuard VPN. We're hiring a Senior Software Engineer to work on the network and control plane.\n\nResponsibilities:\n- Extend the Tailscale client and networking stack\n- Improve relay (DERP) and NAT traversal infrastructure\n- Build features for enterprise networking and access control\n\nRequirements:\n- 5+ years systems or networking engineering\n- Strong Go skills\n- Deep understanding of TCP/IP, UDP, and network protocols\n- Experience with WireGuard or VPN technologies a plus\n\nFully remote.`),

  p(49, 'ML Engineer', 'Stability AI', 'remote', 3, null, 'mid', ['Python', 'PyTorch', 'CUDA', 'Diffusers'], 20,
    `Stability AI is building open-source generative AI. We're hiring an ML Engineer to work on image and video generation model training.\n\nResponsibilities:\n- Train and fine-tune large diffusion models at scale\n- Optimize training throughput and GPU utilization\n- Build evaluation and experimentation infrastructure\n\nRequirements:\n- 3+ years ML engineering\n- Strong PyTorch and CUDA optimization skills\n- Familiarity with diffusion models (Stable Diffusion, SDXL)\n\nRemote.`),

  p(50, 'Backend Engineer', 'Retool', 'remote', 3, 6, 'mid', ['TypeScript', 'Node.js', 'PostgreSQL', 'React'], 22,
    `Retool is the platform for building internal tools. We're hiring a Backend Engineer to work on the query engine and integration layer.\n\nResponsibilities:\n- Build and maintain database and API query connectors\n- Improve performance and reliability of the Retool backend\n- Work on collaboration and permissions infrastructure\n\nRequirements:\n- 3+ years Node.js and TypeScript\n- Experience with relational databases and REST/GraphQL APIs\n- Interest in developer tooling and low-code platforms\n\nRemote.`),

  p(51, 'Senior Platform Engineer', 'Datadog', 'remote', 5, null, 'senior', ['Go', 'Kubernetes', 'Kafka', 'Cassandra'], 24,
    `Datadog is hiring a Senior Platform Engineer to work on the agent and data ingestion pipeline.\n\nResponsibilities:\n- Build the distributed pipeline that ingests billions of metrics per day\n- Improve reliability and performance of the Datadog Agent\n- Work on Kubernetes integration and monitoring\n\nRequirements:\n- 5+ years platform or backend engineering\n- Strong Go skills\n- Experience with Kafka, Cassandra, or similar at scale\n\nRemote.`),

  p(52, 'Staff Engineer', 'Coinbase', 'remote', 8, null, 'staff', ['Go', 'TypeScript', 'Ethereum', 'AWS'], 26,
    `Coinbase is hiring a Staff Engineer to lead technical direction for the blockchain infrastructure team.\n\nYou will:\n- Define architecture for multi-chain custody and transaction infrastructure\n- Lead design reviews for security-critical systems\n- Partner with the security team on threat modelling\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Experience with blockchain protocols (Ethereum, Bitcoin, etc.)\n- Deep security engineering background\n\nRemote.`),

  p(53, 'Senior Backend Engineer', 'Airtable', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Python', 'Go', 'Kubernetes', 'PostgreSQL'], 28,
    `Airtable is hiring a Senior Backend Engineer for the core platform team.\n\nResponsibilities:\n- Build scalable APIs powering the Airtable product\n- Improve the database and spreadsheet abstraction layer\n- Work on automation and workflow execution engines\n\nRequirements:\n- 5+ years backend engineering (Python and/or Go)\n- Strong PostgreSQL and data modeling experience\n- Kubernetes operational experience\n\nHybrid in SF.`),

  p(54, 'Software Engineer', 'Encore', 'remote', 2, 5, 'mid', ['Go', 'TypeScript', 'PostgreSQL'], 30,
    `Encore is the backend development platform that removes infrastructure boilerplate. We're hiring a Software Engineer to work on the framework and cloud runtime.\n\nWhat you'll work on:\n- The Encore framework and code generation tooling\n- Cloud infrastructure deployment (AWS, GCP, Azure)\n- The developer dashboard and tracing UI\n\nRequirements:\n- 2+ years Go and/or TypeScript\n- Interest in developer tooling and infrastructure automation\n\nFully remote.`),

  p(55, 'Senior Backend Engineer', 'Brex', 'remote', 5, null, 'senior', ['Go', 'TypeScript', 'PostgreSQL', 'Kafka'], 3,
    `Brex is hiring a Senior Backend Engineer to work on the financial platform powering corporate cards and spend management.\n\nResponsibilities:\n- Build compliant, high-reliability financial transaction systems\n- Design microservices for card issuing and expense management\n- Partner with compliance and risk teams\n\nRequirements:\n- 5+ years backend engineering\n- Strong Go skills\n- Experience with financial systems or compliance requirements a plus\n\nRemote.`),

  p(56, 'Software Engineer', 'Cursor', 'remote', 2, 5, 'mid', ['TypeScript', 'Rust', 'Python', 'LSP'], 5,
    `Cursor is building the AI-first code editor. We're hiring a Software Engineer to work on the editor experience and AI features.\n\nResponsibilities:\n- Build and improve AI-powered code completion and editing features\n- Work on the TypeScript and Rust editor engine\n- Contribute to language server integrations\n\nRequirements:\n- 2+ years software engineering\n- Strong TypeScript skills\n- Experience with LSP, editor tooling, or AI product development a strong plus\n\nRemote.`),

  p(57, 'Senior Data Engineer', 'Snowflake', 'remote', 5, null, 'senior', ['Python', 'SQL', 'Spark', 'dbt'], 7,
    `Snowflake is hiring a Senior Data Engineer to build the internal analytics platform and data products.\n\nResponsibilities:\n- Design and maintain scalable data pipelines on Snowflake\n- Build dbt models and data quality frameworks\n- Partner with analytics engineers across the business\n\nRequirements:\n- 5+ years data engineering\n- Expert SQL and Python skills\n- Deep dbt experience\n- Familiarity with Snowflake or similar cloud data warehouses\n\nRemote.`),

  p(58, 'Senior Full-Stack Engineer', 'HashiCorp', 'remote', 5, null, 'senior', ['Go', 'TypeScript', 'HCL', 'Terraform'], 9,
    `HashiCorp is hiring a Senior Full-Stack Engineer to work on the Terraform Cloud and HCP product suite.\n\nResponsibilities:\n- Build features in the Terraform Cloud UI and API\n- Extend the HCL configuration language tooling\n- Work on state management and plan/apply pipeline infrastructure\n\nRequirements:\n- 5+ years full-stack engineering\n- Strong Go and TypeScript skills\n- Familiarity with Terraform and infrastructure-as-code\n\nRemote.`),

  p(59, 'Software Engineer', 'PostHog', 'remote', 2, 5, 'mid', ['TypeScript', 'Python', 'ClickHouse', 'React'], 11,
    `PostHog is the open source product analytics platform. We're hiring a Software Engineer to work on the core analytics product.\n\nWhat you'll work on:\n- ClickHouse query performance and data pipeline\n- New analytics features (funnels, retention, experiments)\n- Ingestion pipeline and event processing\n\nRequirements:\n- 2+ years TypeScript and/or Python\n- Familiarity with SQL and analytical query engines\n- Interest in open source and developer tooling\n\nFully remote, async-first.`),

  p(60, 'Senior Backend Engineer', 'Sentry', 'remote', 5, null, 'senior', ['Python', 'Rust', 'Kafka', 'ClickHouse'], 13,
    `Sentry is hiring a Senior Backend Engineer to work on the error monitoring and performance tracing infrastructure.\n\nResponsibilities:\n- Scale the event ingestion pipeline to billions of events per day\n- Improve query performance for large-scale ClickHouse datasets\n- Build new alerting and issue detection features\n\nRequirements:\n- 5+ years backend engineering\n- Strong Python skills\n- Experience with Kafka and columnar databases at scale\n\nRemote.`),

  p(61, 'Principal Engineer', 'Stripe', 'remote', 10, null, 'staff', ['Ruby', 'Go', 'Java', 'Kafka'], 15,
    `Stripe is hiring a Principal Engineer for the Payments Platform team.\n\nYou will:\n- Set technical direction for the core payments processing architecture\n- Lead cross-team design reviews for revenue-critical systems\n- Represent engineering in company-level product planning\n\nRequirements:\n- 10+ years engineering with demonstrated principal-level impact\n- Deep experience with distributed payments or financial systems\n- Track record of driving large-scale technical transformations\n\nRemote or SF.`),

  p(62, 'Senior Software Engineer', 'Doppler', 'remote', 4, null, 'senior', ['Go', 'TypeScript', 'PostgreSQL', 'React'], 17,
    `Doppler is the universal secrets manager for developers. We're hiring a Senior Software Engineer to work on the core platform.\n\nResponsibilities:\n- Build and extend the secrets syncing and integration layer\n- Improve audit logging and access control\n- Work on the developer-facing dashboard and CLI\n\nRequirements:\n- 4+ years backend and/or full-stack engineering\n- Strong Go and TypeScript skills\n- Interest in developer security tooling\n\nRemote.`),

  p(63, 'Staff Engineer', 'Twilio', 'remote', 8, null, 'staff', ['Java', 'Go', 'Kafka', 'Kubernetes'], 19,
    `Twilio is hiring a Staff Engineer to lead the communications platform architecture.\n\nYou will:\n- Define technical strategy for SMS, voice, and messaging infrastructure\n- Lead complex, multi-team engineering initiatives\n- Drive reliability and compliance improvements at scale\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Deep experience with telecommunications protocols\n- Strong Java and/or Go skills\n\nRemote.`),

  p(64, 'Backend Engineer', 'Liveblocks', 'remote', 2, 5, 'mid', ['TypeScript', 'Node.js', 'Redis', 'WebSockets'], 21,
    `Liveblocks is the platform for building collaborative features. We're hiring a Backend Engineer for the real-time infrastructure.\n\nWhat you'll work on:\n- WebSocket-based presence and sync infrastructure\n- Storage, conflicts, and CRDT-based collaboration primitives\n- Developer-facing REST and realtime APIs\n\nRequirements:\n- 2+ years TypeScript and Node.js\n- Experience with WebSockets or real-time systems\n- Familiarity with CRDTs or OT a plus\n\nRemote.`),

  p(65, 'Senior SRE', 'Atlassian', 'remote', 5, null, 'senior', ['Go', 'Python', 'Terraform', 'AWS'], 23,
    `Atlassian is hiring a Senior SRE to work on the Jira and Confluence cloud platform reliability.\n\nResponsibilities:\n- Define and enforce SLOs for Atlassian's cloud products\n- Build infrastructure automation with Terraform and AWS\n- Lead chaos engineering and disaster recovery initiatives\n\nRequirements:\n- 5+ years SRE or platform engineering\n- Strong Python and/or Go skills\n- Expert-level AWS and Terraform experience\n\nRemote.`),

  p(66, 'Senior ML Engineer', 'OpenAI', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Python', 'CUDA', 'PyTorch', 'Triton'], 2,
    `OpenAI is hiring a Senior ML Engineer for the training infrastructure team.\n\nResponsibilities:\n- Optimize large-scale distributed training pipelines\n- Write high-performance CUDA and Triton kernels\n- Collaborate with researchers to ship new model capabilities\n\nRequirements:\n- 5+ years ML engineering\n- Deep CUDA optimization and GPU architecture knowledge\n- Expert PyTorch skills\n- Experience with models at 100B+ parameter scale\n\nHybrid in SF.`),

  p(67, 'Senior Backend Engineer', 'Intercom', 'remote', 5, null, 'senior', ['Ruby', 'Go', 'Kafka', 'Elasticsearch'], 4,
    `Intercom is hiring a Senior Backend Engineer to work on the messaging and customer support platform.\n\nResponsibilities:\n- Build and scale the real-time messaging infrastructure\n- Improve search and data pipeline performance\n- Work on AI-powered support and routing features\n\nRequirements:\n- 5+ years backend engineering\n- Strong Ruby and/or Go experience\n- Experience with Kafka and Elasticsearch at scale\n\nRemote.`),

  p(68, 'Staff Software Engineer', 'Figma', 'hybrid — San Francisco, CA', 8, null, 'staff', ['TypeScript', 'C++', 'WebAssembly', 'Rust'], 6,
    `Figma is hiring a Staff Engineer to lead the editor engine and runtime team.\n\nYou will:\n- Define technical strategy for the Figma rendering and editing engine\n- Drive performance initiatives across the multiplayer editing stack\n- Lead a team of senior engineers\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Deep expertise in C++, Rust, or similar systems languages\n- Experience with graphics programming or editor development\n\nHybrid in SF.`),

  p(69, 'Full-Stack Engineer', 'Knock', 'remote', 3, 5, 'mid', ['TypeScript', 'Elixir', 'React', 'PostgreSQL'], 8,
    `Knock is the notification infrastructure platform. We're hiring a Full-Stack Engineer to work on the notification engine and developer dashboard.\n\nWhat you'll work on:\n- The notification workflow engine (Elixir)\n- Developer-facing dashboard and integration UI (React)\n- Client SDKs and API design\n\nRequirements:\n- 3+ years TypeScript and React\n- Elixir or functional programming experience a plus\n- Interest in developer tooling\n\nRemote.`),

  p(70, 'Senior Software Engineer', 'Buildkite', 'remote', 5, null, 'senior', ['Go', 'Ruby', 'React', 'Docker'], 10,
    `Buildkite is the fast and scalable CI/CD platform for large engineering teams. We're hiring a Senior Software Engineer.\n\nResponsibilities:\n- Build and scale the Buildkite agent and pipeline execution engine\n- Improve performance and reliability of the CI/CD platform\n- Work on enterprise features and integrations\n\nRequirements:\n- 5+ years software engineering\n- Strong Go and/or Ruby skills\n- Experience with CI/CD systems and containerized builds\n\nFully remote, async-first.`),

  p(71, 'Backend Engineer', 'Upstash', 'remote', 2, 5, 'mid', ['TypeScript', 'Go', 'Redis', 'Kafka'], 12,
    `Upstash is the serverless data platform (Redis, Kafka, QStash). We're hiring a Backend Engineer.\n\nWhat you'll work on:\n- Serverless Redis and Kafka infrastructure\n- HTTP-based APIs for edge-compatible data access\n- Client SDKs for TypeScript, Python, and Go\n\nRequirements:\n- 2+ years backend engineering\n- Experience with Redis or Kafka internals\n- Strong TypeScript and/or Go skills\n\nRemote.`),

  p(72, 'Senior Backend Engineer', 'Prismatic', 'remote', 5, null, 'senior', ['TypeScript', 'Node.js', 'Kubernetes', 'GraphQL'], 14,
    `Prismatic is the embedded integration platform for B2B SaaS. We're hiring a Senior Backend Engineer.\n\nResponsibilities:\n- Build the integration execution and orchestration engine\n- Scale the multi-tenant pipeline infrastructure\n- Design the next-generation connector SDK\n\nRequirements:\n- 5+ years Node.js and TypeScript\n- Experience with multi-tenant SaaS infrastructure\n- GraphQL API design experience\n\nRemote.`),

  p(73, 'Software Engineer', 'Mintlify', 'remote', 2, 4, 'mid', ['TypeScript', 'Python', 'React', 'MDX'], 16,
    `Mintlify is building beautiful documentation for developer products. We're hiring a Software Engineer.\n\nWhat you'll work on:\n- The Mintlify docs platform and rendering engine\n- AI-powered docs search and content generation\n- Integrations with GitHub, Slack, and analytics tools\n\nRequirements:\n- 2+ years TypeScript and React\n- Interest in developer experience and documentation tooling\n\nRemote.`),

  p(74, 'Junior Backend Engineer', 'Railway', 'remote', 1, 3, 'junior', ['TypeScript', 'Go', 'PostgreSQL', 'Docker'], 18,
    `Railway is hiring a Junior Backend Engineer to join the infrastructure team.\n\nResponsibilities:\n- Build and maintain backend services for the Railway platform\n- Work on deployment pipeline and container orchestration\n- Participate in on-call and incident response\n\nRequirements:\n- 1+ years backend engineering (TypeScript or Go)\n- Strong fundamentals in databases and REST APIs\n- Eagerness to learn and grow in a fast-paced startup\n\nFully remote. Excellent mentorship.`),

  p(75, 'Software Engineer', 'Linear', 'remote', 2, 4, 'mid', ['TypeScript', 'React', 'Node.js', 'Electron'], 20,
    `Linear is hiring a Software Engineer to work on the desktop app and cross-platform experience.\n\nWhat you'll work on:\n- The Electron-based desktop app\n- Cross-platform parity between web, desktop, and mobile\n- Performance and offline sync improvements\n\nRequirements:\n- 2+ years TypeScript and React\n- Experience with Electron or cross-platform development\n- Strong UX instincts\n\nRemote.`),

  p(76, 'Senior DevOps Engineer', 'Grafana Labs', 'remote', 5, null, 'senior', ['Terraform', 'Go', 'Kubernetes', 'GCP'], 22,
    `Grafana Labs is hiring a Senior DevOps Engineer to work on internal platform infrastructure.\n\nResponsibilities:\n- Build and maintain multi-cloud Kubernetes infrastructure\n- Develop internal developer platform tooling\n- Implement security and compliance automation\n\nRequirements:\n- 5+ years DevOps or platform engineering\n- Expert Terraform and Kubernetes skills\n- Experience with GCP and AWS\n\nFully remote.`),

  p(77, 'Backend Engineer, Growth', 'Notion', 'hybrid — San Francisco, CA', 3, 6, 'mid', ['TypeScript', 'Node.js', 'PostgreSQL', 'Python'], 24,
    `Notion is hiring a Backend Engineer for the Growth team to work on onboarding, activation, and monetization infrastructure.\n\nResponsibilities:\n- Build experimentation and A/B testing infrastructure\n- Work on onboarding flows and in-product activation\n- Partner with data science on growth models\n\nRequirements:\n- 3+ years backend engineering (TypeScript, Python, or similar)\n- Experience with experimentation frameworks\n- Data-driven approach to engineering decisions\n\nHybrid in SF.`),

  p(78, 'Senior Infrastructure Engineer', 'Vercel', 'remote', 5, null, 'senior', ['Rust', 'Go', 'TypeScript', 'AWS'], 26,
    `Vercel is hiring a Senior Infrastructure Engineer to work on the build and deployment pipeline.\n\nResponsibilities:\n- Optimize build performance across Node.js, Python, and Rust runtimes\n- Scale the global deployment and CDN infrastructure\n- Improve cold start latency for serverless functions\n\nRequirements:\n- 5+ years infrastructure or platform engineering\n- Rust and/or Go expertise\n- Experience with AWS at scale\n\nFully remote.`),

  p(79, 'Junior Frontend Engineer', 'Supabase', 'remote', 0, 2, 'junior', ['TypeScript', 'React', 'Next.js', 'Tailwind'], 28,
    `Supabase is hiring a Junior Frontend Engineer to work on the Supabase dashboard.\n\nResponsibilities:\n- Build and improve the Supabase Studio dashboard\n- Work on database visualization and query editor features\n- Contribute to open source frontend components\n\nRequirements:\n- Some professional TypeScript and React experience\n- Strong HTML/CSS fundamentals\n- Passion for great UX and developer tools\n- Open source experience a big plus\n\nFully remote, mentorship available.`),

  p(80, 'Senior Backend Engineer', 'Discord', 'remote', 5, null, 'senior', ['Python', 'Rust', 'Cassandra', 'Redis'], 3,
    `Discord is hiring a Senior Backend Engineer for the Voice and Video Infrastructure team.\n\nResponsibilities:\n- Scale the WebRTC-based voice and video infrastructure\n- Optimize media routing for low-latency global delivery\n- Build next-generation audio processing features\n\nRequirements:\n- 5+ years backend engineering\n- Experience with real-time media protocols (WebRTC, RTP)\n- Strong Rust and/or Python skills\n\nRemote (US).`),

  p(81, 'Staff Engineer, ML Platform', 'Airbnb', 'hybrid — San Francisco, CA', 8, null, 'staff', ['Python', 'PyTorch', 'Spark', 'Kubernetes'], 5,
    `Airbnb is hiring a Staff Engineer for the ML Platform team.\n\nYou will:\n- Define technical direction for the ML feature store and training platform\n- Lead cross-team design reviews for ML infrastructure\n- Partner with applied science teams on deployment patterns\n\nRequirements:\n- 8+ years engineering, with significant ML infrastructure experience\n- Deep Python and distributed systems expertise\n- Track record of shipping ML infrastructure at scale\n\nHybrid in SF.`),

  p(82, 'Senior Software Engineer', 'Cloudflare', 'remote', 5, null, 'senior', ['Go', 'Rust', 'DNS', 'BGP'], 7,
    `Cloudflare is hiring a Senior Software Engineer for the Networking team.\n\nResponsibilities:\n- Build and maintain the global anycast network and DNS resolver\n- Work on BGP routing and network protocols at scale\n- Improve DDoS mitigation and traffic filtering systems\n\nRequirements:\n- 5+ years networking or systems engineering\n- Deep understanding of DNS, BGP, and internet routing protocols\n- Strong Go and/or Rust skills\n\nFully remote.`),

  p(83, 'Backend Engineer', 'Temporal', 'remote', 3, 6, 'mid', ['Go', 'Java', 'gRPC', 'PostgreSQL'], 9,
    `Temporal is hiring a Backend Engineer to work on the open source workflow orchestration platform.\n\nWhat you'll work on:\n- Core server features and workflow scheduling engine\n- Database persistence layer improvements (PostgreSQL, MySQL)\n- Client SDK enhancements for Go and Java\n\nRequirements:\n- 3+ years backend engineering\n- Strong Go and/or Java skills\n- Interest in distributed systems and workflow engines\n\nRemote.`),

  p(84, 'Intern — Software Engineer', 'PlanetScale', 'remote', null, null, 'intern', ['Go', 'MySQL', 'TypeScript'], 11,
    `PlanetScale is looking for a Software Engineering Intern to join the database platform team for a summer internship.\n\nYou'll work on:\n- A defined project within the MySQL-compatible serverless database\n- Real production code shipping to customers\n- Mentorship from experienced engineers\n\nRequirements:\n- Pursuing a BS/MS in Computer Science or related field\n- Experience with Go, TypeScript, or similar languages\n- Curiosity about database internals\n\nRemote.`),

  p(85, 'Senior Full-Stack Engineer', 'Retool', 'remote', 5, null, 'senior', ['TypeScript', 'React', 'Node.js', 'PostgreSQL'], 13,
    `Retool is hiring a Senior Full-Stack Engineer to work on the core product building experience.\n\nResponsibilities:\n- Build new component types and data connectors\n- Improve the drag-and-drop editor performance\n- Work on enterprise collaboration and version control features\n\nRequirements:\n- 5+ years TypeScript and React\n- Strong Node.js backend skills\n- Experience building complex UI component systems\n\nRemote.`),

  p(86, 'Senior Software Engineer', 'Brex', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Go', 'Kotlin', 'AWS', 'PostgreSQL'], 15,
    `Brex is hiring a Senior Software Engineer for the Card Infrastructure team.\n\nResponsibilities:\n- Build the systems powering real-time card authorization and settlement\n- Improve reliability of financial transaction processing\n- Work on compliance and reporting infrastructure\n\nRequirements:\n- 5+ years backend engineering in financial systems\n- Strong Go or Kotlin skills\n- Understanding of payment card networks (Visa, Mastercard)\n\nHybrid in SF.`),

  p(87, 'Software Engineer, DevTools', 'Vercel', 'remote', 3, 5, 'mid', ['TypeScript', 'Rust', 'Node.js', 'React'], 17,
    `Vercel is hiring a Software Engineer for the Developer Experience team.\n\nWhat you'll work on:\n- Next.js framework core and developer tooling\n- The Vercel CLI and local development experience\n- Error messages, diagnostics, and build output\n\nRequirements:\n- 3+ years TypeScript and Node.js\n- Passion for great developer experience and tooling\n- Open source experience a plus\n\nRemote.`),

  p(88, 'Senior Data Engineer', 'Plaid', 'remote', 5, null, 'senior', ['Python', 'Spark', 'Airflow', 'Snowflake'], 19,
    `Plaid is hiring a Senior Data Engineer to build the data infrastructure powering financial analytics.\n\nResponsibilities:\n- Design and maintain large-scale financial data pipelines\n- Build data quality monitoring and lineage tracking\n- Partner with data science on feature engineering\n\nRequirements:\n- 5+ years data engineering\n- Expert Python and SQL skills\n- Deep experience with Spark, Airflow, and cloud data warehouses\n\nRemote.`),

  p(89, 'Backend Engineer', 'Grafana Labs', 'remote', 3, 6, 'mid', ['Go', 'Prometheus', 'Loki', 'Kubernetes'], 21,
    `Grafana Labs is hiring a Backend Engineer to work on Loki, the log aggregation system.\n\nResponsibilities:\n- Build and scale the Loki ingest and query pipeline\n- Improve storage and compression efficiency\n- Contribute to open source Loki\n\nRequirements:\n- 3+ years Go engineering\n- Experience with logging systems or observability platforms\n- Familiarity with time-series or columnar storage\n\nFully remote.`),

  p(90, 'Senior Backend Engineer', 'Hashicorp', 'remote', 5, null, 'senior', ['Go', 'gRPC', 'Raft', 'TLS'], 23,
    `HashiCorp is hiring a Senior Backend Engineer to work on Vault, the secrets management platform.\n\nResponsibilities:\n- Implement new authentication methods and secret engines\n- Improve Vault's distributed storage and Raft consensus layer\n- Work on enterprise features (MFA, HSM, replication)\n\nRequirements:\n- 5+ years backend engineering in Go\n- Understanding of cryptography and secrets management\n- Familiarity with distributed consensus algorithms\n\nRemote.`),

  p(91, 'Software Engineer', 'Oxide Computer', 'on-site — San Francisco, CA', 3, 6, 'mid', ['Rust', 'C', 'ARM', 'Embedded'], 25,
    `Oxide Computer is hiring a Software Engineer for the embedded firmware team.\n\nWhat you'll work on:\n- Firmware for the Oxide Rack's service processor network\n- Real-time embedded Rust on bare metal ARM\n- Hardware bring-up and debugging\n\nRequirements:\n- 3+ years embedded or systems engineering\n- Strong Rust or C programming skills\n- Experience with ARM microcontrollers or embedded Linux\n\nOn-site in San Francisco.`),

  p(92, 'Senior Backend Engineer', 'Airtable', 'remote', 5, null, 'senior', ['Node.js', 'TypeScript', 'PostgreSQL', 'Redis'], 27,
    `Airtable is hiring a Senior Backend Engineer for the Automations and Scripting team.\n\nResponsibilities:\n- Build the sandboxed script execution engine\n- Scale the workflow automation trigger and action infrastructure\n- Improve reliability and observability of automation pipelines\n\nRequirements:\n- 5+ years Node.js and TypeScript\n- Experience with sandboxed code execution\n- Strong PostgreSQL data modeling skills\n\nRemote.`),

  p(93, 'Junior Software Engineer', 'Prisma', 'remote', 0, 2, 'junior', ['TypeScript', 'Node.js', 'PostgreSQL', 'Rust'], 29,
    `Prisma is hiring a Junior Software Engineer to join the ORM and developer tooling team.\n\nResponsibilities:\n- Fix bugs and implement features in Prisma Client\n- Write tests and improve documentation\n- Engage with the open source community on GitHub\n\nRequirements:\n- Some professional experience with TypeScript\n- Familiarity with SQL and ORMs\n- Strong written communication skills for async work\n\nFully remote.`),

  p(94, 'Senior Platform Engineer', 'PagerDuty', 'remote', 5, null, 'senior', ['Go', 'Kubernetes', 'Terraform', 'AWS'], 4,
    `PagerDuty is hiring a Senior Platform Engineer to work on the internal developer platform.\n\nResponsibilities:\n- Build golden path templates and service scaffolding\n- Maintain shared Kubernetes infrastructure and CI/CD pipelines\n- Implement cost and reliability improvements\n\nRequirements:\n- 5+ years platform or DevOps engineering\n- Expert Kubernetes and Terraform skills\n- Strong Go scripting and tooling experience\n\nRemote.`),

  p(95, 'Staff Engineer, Developer Experience', 'Stripe', 'remote', 8, null, 'staff', ['Ruby', 'TypeScript', 'Go', 'gRPC'], 6,
    `Stripe is hiring a Staff Engineer for the Developer Experience team.\n\nYou will:\n- Define technical direction for Stripe's API design and SDKs\n- Drive adoption of internal platform improvements across engineering\n- Lead the roadmap for developer-facing tooling\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Strong API design and SDK development experience\n- Track record of improving developer productivity at scale\n\nRemote or SF.`),

  p(96, 'Backend Engineer', 'Liveblocks', 'remote', 3, 5, 'mid', ['TypeScript', 'Elixir', 'PostgreSQL', 'Redis'], 8,
    `Liveblocks is hiring a Backend Engineer to work on the storage and sync infrastructure.\n\nResponsibilities:\n- Build Yjs-based document sync and conflict resolution\n- Scale multi-room WebSocket presence infrastructure\n- Improve the storage backend for large collaborative documents\n\nRequirements:\n- 3+ years TypeScript and/or Elixir\n- Experience with real-time systems or CRDT-based sync\n\nRemote.`),

  p(97, 'Senior Software Engineer', 'Sentry', 'remote', 5, null, 'senior', ['Python', 'TypeScript', 'React', 'Kafka'], 10,
    `Sentry is hiring a Senior Software Engineer for the Product team.\n\nResponsibilities:\n- Build new product features for issue tracking and error analysis\n- Work across the Python backend and React frontend\n- Improve the AI-powered issue deduplication and grouping\n\nRequirements:\n- 5+ years full-stack engineering\n- Strong Python (Django) and TypeScript/React skills\n- Experience with high-volume event processing\n\nRemote.`),

  p(98, 'Software Engineer, Infrastructure', 'Neon', 'remote', 3, 6, 'mid', ['Rust', 'Go', 'PostgreSQL', 'AWS'], 12,
    `Neon is hiring a Software Engineer for the compute and networking team.\n\nWhat you'll work on:\n- The Neon compute proxy and connection pooler\n- Auto-scaling and cold start latency improvements\n- Networking between compute nodes and the storage layer\n\nRequirements:\n- 3+ years systems engineering\n- Rust and/or Go experience\n- Familiarity with PostgreSQL wire protocol\n\nFully remote.`),

  p(99, 'Senior Full-Stack Engineer', 'PostHog', 'remote', 5, null, 'senior', ['TypeScript', 'Python', 'React', 'ClickHouse'], 14,
    `PostHog is hiring a Senior Full-Stack Engineer to work on the core product analytics experience.\n\nResponsibilities:\n- Build new analytics visualizations and exploration tools\n- Improve query performance for large customer datasets\n- Contribute to open source PostHog\n\nRequirements:\n- 5+ years TypeScript/React and Python\n- Experience with ClickHouse or analytical query engines\n- Open source contributions welcome\n\nFully remote, async-first.`),

  p(100, 'Staff Engineer, Search', 'Shopify', 'remote', 8, null, 'staff', ['Ruby', 'Go', 'Elasticsearch', 'Kafka'], 16,
    `Shopify is hiring a Staff Engineer to lead the Search Infrastructure team.\n\nYou will:\n- Define technical strategy for merchant and buyer search\n- Lead scaling of Elasticsearch clusters to handle BFCM peak\n- Drive cross-team relevance improvement initiatives\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Deep Elasticsearch and search relevance expertise\n- Strong Go or Ruby background\n\nRemote-first.`),

  p(101, 'Senior Backend Engineer', 'Datadog', 'remote', 5, null, 'senior', ['Python', 'Go', 'ClickHouse', 'S3'], 18,
    `Datadog is hiring a Senior Backend Engineer for the Logs product team.\n\nResponsibilities:\n- Build the log ingestion, indexing, and search pipeline\n- Optimize ClickHouse-based log storage and query\n- Improve live tail and streaming log features\n\nRequirements:\n- 5+ years backend engineering\n- Strong Python and Go skills\n- Experience with columnar databases at petabyte scale\n\nRemote.`),

  p(102, 'Software Engineer', 'Cursor', 'remote', 2, 4, 'mid', ['Rust', 'TypeScript', 'Tree-sitter', 'LSP'], 20,
    `Cursor is hiring a Software Engineer to work on the AI-native editor experience.\n\nResponsibilities:\n- Build AI-powered code suggestion and refactoring features\n- Work on Rust-based editor engine and Tree-sitter integrations\n- Improve multi-model context management\n\nRequirements:\n- 2+ years engineering\n- Strong Rust or TypeScript skills\n- Experience with editor tooling, LSP, or Tree-sitter a big plus\n\nRemote.`),

  p(103, 'Senior Infrastructure Engineer', 'Cloudflare', 'remote', 5, null, 'senior', ['Go', 'Terraform', 'Kubernetes', 'Rust'], 22,
    `Cloudflare is hiring a Senior Infrastructure Engineer for the Internal Developer Platform team.\n\nResponsibilities:\n- Build CI/CD pipelines for deploying to Cloudflare's 200+ PoPs\n- Develop internal tooling and platform automation\n- Improve deployment safety and rollout tooling\n\nRequirements:\n- 5+ years infrastructure engineering\n- Expert Terraform and Kubernetes skills\n- Go and/or Rust preferred\n\nFully remote.`),

  p(104, 'Senior Backend Engineer', 'Intercom', 'hybrid — Dublin, Ireland', 5, null, 'senior', ['Ruby', 'Go', 'PostgreSQL', 'Redis'], 24,
    `Intercom is hiring a Senior Backend Engineer for the Conversations team in Dublin.\n\nResponsibilities:\n- Scale the inbox and conversation threading infrastructure\n- Build AI-powered reply suggestions and routing\n- Improve real-time notification delivery\n\nRequirements:\n- 5+ years backend engineering\n- Strong Ruby and/or Go skills\n- Experience with PostgreSQL at scale\n\nHybrid in Dublin.`),

  p(105, 'Software Engineer', 'Buildkite', 'remote', 2, 5, 'mid', ['Go', 'Ruby', 'Docker', 'Bash'], 26,
    `Buildkite is hiring a Software Engineer to work on the agent and build execution layer.\n\nWhat you'll work on:\n- The open source Buildkite Agent (Go)\n- Containerized build execution and Docker integration\n- Plugin and integration ecosystem\n\nRequirements:\n- 2+ years Go and/or Ruby\n- Familiarity with CI/CD systems and containerized builds\n- Open source experience a plus\n\nFully remote.`),

  p(106, 'Senior Backend Engineer', 'Atlassian', 'remote', 5, null, 'senior', ['Java', 'Kotlin', 'Kubernetes', 'PostgreSQL'], 2,
    `Atlassian is hiring a Senior Backend Engineer for the Jira platform team.\n\nResponsibilities:\n- Build and scale the Jira issue tracking and workflow engine\n- Improve performance of large-instance board rendering and queries\n- Lead backend design for new platform features\n\nRequirements:\n- 5+ years backend engineering in Java and/or Kotlin\n- Experience with large-scale SaaS platforms\n- Kubernetes and PostgreSQL operational knowledge\n\nRemote.`),

  p(107, 'Machine Learning Engineer', 'Replicate', 'remote', 3, 7, 'mid', ['Python', 'CUDA', 'Go', 'Docker'], 4,
    `Replicate is hiring an ML Engineer to work on model packaging and serving infrastructure.\n\nResponsibilities:\n- Build the Cog container framework for reproducible ML models\n- Optimize GPU inference latency for diverse model architectures\n- Develop prediction caching and batching infrastructure\n\nRequirements:\n- 3+ years ML engineering\n- Strong Python and CUDA skills\n- Experience packaging and serving ML models at scale\n\nRemote.`),

  p(108, 'Staff Engineer, Platform', 'Discord', 'hybrid — San Francisco, CA', 8, null, 'staff', ['Python', 'Rust', 'Kubernetes', 'Kafka'], 6,
    `Discord is hiring a Staff Engineer for the Platform Infrastructure team.\n\nYou will:\n- Lead technical strategy for Discord's microservices and data platform\n- Drive cross-team initiatives on observability and reliability\n- Partner with security and SRE teams on platform standards\n\nRequirements:\n- 8+ years engineering with staff-level impact\n- Deep Kubernetes and distributed systems experience\n- Strong Python and/or Rust background\n\nHybrid in SF.`),

  p(109, 'Senior Full-Stack Engineer', 'Sentry', 'remote', 5, null, 'senior', ['Python', 'TypeScript', 'React', 'ClickHouse'], 8,
    `Sentry is hiring a Senior Full-Stack Engineer for the Performance Monitoring team.\n\nResponsibilities:\n- Build new profiling and distributed tracing visualizations\n- Optimize ClickHouse query performance for trace data\n- Work on the React frontend and Python backend\n\nRequirements:\n- 5+ years full-stack engineering\n- Strong React/TypeScript and Python skills\n- Experience with distributed tracing (Jaeger, Zipkin) a plus\n\nRemote.`),

  p(110, 'Junior Data Engineer', 'Databricks', 'remote', 1, 3, 'junior', ['Python', 'SQL', 'Spark', 'dbt'], 10,
    `Databricks is hiring a Junior Data Engineer to join the data platform team.\n\nResponsibilities:\n- Build and maintain ETL pipelines on Databricks and Spark\n- Write dbt models for business analytics\n- Monitor data quality and pipeline health\n\nRequirements:\n- 1+ years data engineering or data analysis\n- Strong Python and SQL skills\n- Familiarity with Spark or dbt a plus\n\nRemote. Mentorship available.`),

  p(111, 'Senior Mobile Engineer', 'Notion', 'hybrid — San Francisco, CA', 5, null, 'senior', ['Swift', 'Kotlin', 'TypeScript', 'SQLite'], 12,
    `Notion is hiring a Senior Mobile Engineer to work on the iOS and Android apps.\n\nResponsibilities:\n- Build and optimize the Notion mobile editor experience\n- Implement offline sync and conflict resolution\n- Improve app performance and startup time\n\nRequirements:\n- 5+ years mobile engineering (Swift and/or Kotlin)\n- Experience with offline-first sync and SQLite on mobile\n- Strong understanding of mobile performance optimization\n\nHybrid in SF.`),

  p(112, 'Senior Backend Engineer', 'Tailscale', 'remote', 5, null, 'senior', ['Go', 'Linux', 'eBPF', 'Networking'], 14,
    `Tailscale is hiring a Senior Backend Engineer for the control plane team.\n\nResponsibilities:\n- Scale the coordination server for millions of devices\n- Build multi-tenant access control and policy enforcement\n- Improve device registration and key management\n\nRequirements:\n- 5+ years backend engineering in Go\n- Experience with network programming and Linux kernel interfaces\n- Understanding of PKI and certificate management\n\nRemote.`),

  p(113, 'Software Engineer', 'Modal', 'remote', 2, 5, 'mid', ['Python', 'Rust', 'Kubernetes', 'gVisor'], 16,
    `Modal is hiring a Software Engineer to work on the GPU container orchestration and scheduling layer.\n\nWhat you'll work on:\n- GPU scheduling and multi-tenancy isolation\n- Container lifecycle management and cold-start optimization\n- The Python SDK and developer experience\n\nRequirements:\n- 2+ years systems or backend engineering\n- Strong Python skills\n- Experience with Kubernetes or container runtimes a plus\n\nRemote.`),

  p(114, 'Senior Backend Engineer', 'Coinbase', 'remote', 5, null, 'senior', ['Go', 'gRPC', 'PostgreSQL', 'Ethereum'], 18,
    `Coinbase is hiring a Senior Backend Engineer for the Staking team.\n\nResponsibilities:\n- Build the staking infrastructure for Ethereum, Solana, and Cosmos\n- Work on slashing protection and validator key management\n- Improve reliability of staking reward distribution\n\nRequirements:\n- 5+ years backend engineering\n- Strong Go and distributed systems skills\n- Understanding of blockchain staking protocols a plus\n\nRemote.`),

  p(115, 'Full-Stack Engineer', 'Resend', 'remote', 3, 5, 'mid', ['TypeScript', 'React', 'Next.js', 'PostgreSQL'], 20,
    `Resend is hiring a Full-Stack Engineer to work on the developer dashboard and API explorer.\n\nWhat you'll build:\n- The Resend dashboard (Next.js + React)\n- Email analytics and delivery insights UI\n- API playground and documentation tools\n\nRequirements:\n- 3+ years TypeScript and React\n- Next.js experience\n- Interest in developer experience and email infrastructure\n\nRemote.`),

  p(116, 'Senior Software Engineer', 'PostHog', 'remote', 5, null, 'senior', ['Python', 'Go', 'ClickHouse', 'Kubernetes'], 22,
    `PostHog is hiring a Senior Software Engineer for the Infrastructure team.\n\nResponsibilities:\n- Scale ClickHouse clusters for petabyte-scale analytics\n- Build multi-tenant infrastructure on Kubernetes\n- Improve CI/CD and deployment reliability\n\nRequirements:\n- 5+ years backend and/or infrastructure engineering\n- ClickHouse or large-scale database administration experience\n- Strong Python and/or Go skills\n\nFully remote.`),

  p(117, 'Backend Engineer', 'Clerk', 'remote', 3, 6, 'mid', ['TypeScript', 'Node.js', 'PostgreSQL', 'Redis'], 24,
    `Clerk is hiring a Backend Engineer to work on the authentication and user management platform.\n\nResponsibilities:\n- Build auth middleware, session management, and MFA features\n- Implement OAuth 2.0 and OIDC protocol extensions\n- Improve rate limiting and abuse prevention\n\nRequirements:\n- 3+ years Node.js and TypeScript\n- Understanding of auth protocols (OAuth, OIDC, JWT)\n- Experience with multi-tenant SaaS infrastructure\n\nRemote.`),

  p(118, 'Intern — ML Engineering', 'Anthropic', 'hybrid — San Francisco, CA', null, null, 'intern', ['Python', 'PyTorch', 'JAX'], 26,
    `Anthropic is offering a summer internship for an ML Engineering Intern.\n\nYou'll work on:\n- A defined project contributing to safety research infrastructure\n- Training pipeline tooling or evaluation framework development\n- Real impactful work alongside research scientists\n\nRequirements:\n- Pursuing BS/MS/PhD in CS, ML, or related field\n- Strong Python and ML framework experience (PyTorch or JAX)\n- Research experience or published work a strong plus\n\nHybrid in SF.`),

  p(119, 'Senior Software Engineer', 'Warp', 'remote', 5, null, 'senior', ['Rust', 'TypeScript', 'macOS', 'Linux'], 28,
    `Warp is hiring a Senior Software Engineer to work on AI features and terminal intelligence.\n\nResponsibilities:\n- Build AI-powered command suggestions and terminal workflows\n- Work on the natural language command understanding engine\n- Integrate LLMs into the terminal experience\n\nRequirements:\n- 5+ years software engineering\n- Strong Rust and/or TypeScript skills\n- Experience integrating LLM APIs into products\n\nRemote.`),

  p(120, 'Senior Backend Engineer', 'PlanetScale', 'remote', 5, null, 'senior', ['Go', 'MySQL', 'Vitess', 'Kubernetes'], 30,
    `PlanetScale is hiring a Senior Backend Engineer to work on the database platform and developer experience.\n\nResponsibilities:\n- Build new features for database branching and deploy requests\n- Improve the schema change and non-blocking DDL pipeline\n- Work on Insights and query performance analytics\n\nRequirements:\n- 5+ years backend engineering\n- Strong Go skills\n- MySQL query optimization and schema design experience\n\nFully remote.`),
]

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class MockAdapter extends BaseAdapter {
  override readonly id = 'mock'
  override readonly delayMs = CRAWL_DELAY_MS
  override readonly availableSignals = new Set(['recency'])

  override async search(
    _term: string,
    _filters: SearchFilters,
    onPosting?: (posting: Omit<JobPosting, 'id'>) => void,
    _onCaptchaRequired?: () => Promise<void>,
    signal?: CrawlSignal,
  ): Promise<void> {
    const now = new Date().toISOString()
    const isTest = process.env.APP_TEST === '1'
    const rawCount = isTest
      ? RESULTS_PER_CRAWL_MIN
      : RESULTS_PER_CRAWL_MIN + Math.floor(Math.random() * (RESULTS_PER_CRAWL_MAX - RESULTS_PER_CRAWL_MIN + 1))
    const count = _filters.maxResults != null ? Math.min(rawCount, _filters.maxResults) : rawCount

    // Fisher-Yates shuffle (skipped in test mode for deterministic deduplication)
    const pool = MOCK_POOL.slice()
    if (!isTest) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[pool[i], pool[j]] = [pool[j], pool[i]]
      }
    }

    for (const posting of pool.slice(0, count)) {
      await signal?.waitForResume()
      signal?.checkAborted()

      if (this.delayMs > 0) {
        // Vary the delay ±40% to mimic real page-load jitter
        const jitter = this.delayMs * 0.4
        const delay = this.delayMs - jitter + Math.random() * jitter * 2
        await new Promise((r) => setTimeout(r, delay))
      }
      onPosting?.({ ...posting, fetched_at: now, last_seen_at: now })
    }
  }
}

export default MockAdapter
