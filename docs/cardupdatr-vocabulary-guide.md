# CardUpdatr Analytics Vocabulary Guide

**Purpose:** Standard vocabulary for CardUpdatr engagement metrics — what we call things, what they mean, and why we chose these terms. Use this as the shared reference when discussing dashboards, reports, and partner-facing materials.

**Audience:** Strivve team, integration partners, FI contacts

---

## The Cardholder Journey (Funnel)

When a cardholder uses CardUpdatr, they move through a funnel. Each step has a clear name:

| Step | Term | What It Means |
|---|---|---|
| 1 | **Visit** (or **Session**) | A cardholder reaches the CardUpdatr experience. One visit = one person opening CardUpdatr, regardless of whether they complete anything. |
| 2 | **Merchant Selection** | The cardholder sees the list of merchants and selects one or more to update. This is the first moment of intent. |
| 3 | **Credential Entry** | The cardholder begins entering their login credentials for a merchant site. This signals real commitment. |
| 4 | **Card Update Attempted** | CardUpdatr begins the process of updating the card at the selected merchant(s). Each merchant is one update attempt. |
| 5 | **Card Successfully Updated** | The card was updated at the merchant. This is the outcome that matters. |

### Why "Visit" instead of "Session"

"Session" is technically accurate (it maps to a CardSavr API session) but reads as developer jargon to partners and FIs. "Visit" is how the rest of the web analytics world describes someone showing up. In partner-facing materials, we use **Visit**. In internal/technical contexts, "Session" is fine.

### Why "Card Update" instead of "Placement" or "Job"

Internally, the CardSavr platform calls each card update attempt a "placement" or "job." These are system-level terms that mean nothing to a partner. A partner understands: *"42 cards were successfully updated."* They don't need to know it was a "placement job." In partner-facing materials, we use **Card Update**. Internally, "placement" and "job" are acceptable shorthand.

---

## Key Metrics

| Metric | Definition | Why This Name |
|---|---|---|
| **Visits** | Total unique cardholder sessions in the selected time period. | Plain, universal, needs no explanation. |
| **Cards Updated** | Total successful card updates across all merchants. One cardholder updating 3 merchants = 3 cards updated. | Outcome-focused. Tells the partner exactly what happened. |
| **Successful Cardholders** | Cardholders who completed at least one successful card update. | Distinguishes *people* from *updates*. A partner cares about both: how many people succeeded, and how many total cards were updated. |
| **Success Rate** | Successful card updates / total card updates attempted. | Standard conversion metric. Includes all failure types. |
| **System Success Rate** | Successful card updates / (successful + system-caused failures). Excludes failures caused by the cardholder (wrong password, timeout, cancellation). | Answers: *"When the system was fully in play, how often did it work?"* Useful for isolating product reliability from cardholder behavior. |
| **Monthly Reach** | Projected monthly rate at which cardholders engage with CardUpdatr, based on the selected time window. Calculated as: (visits / total cardholders on file) extrapolated to a full month. | "Reach" is borrowed from media/marketing — the percentage of your audience that encounters the product. Helps partners understand adoption velocity without needing raw session counts. |

---

## Motivation Tiers

The single most important insight in CardUpdatr analytics: **conversion rate is determined by cardholder motivation at the moment of encounter, not product quality.**

We classify FI traffic into motivation tiers based on the observed success rate:

| Tier | Name | Success Rate | What It Means |
|---|---|---|---|
| Highest | **Activation** | 21%+ | Cardholder just received a new card (reissue, lost/stolen replacement). They have an urgent, personal reason to update. ~1 in 4 completes. |
| Transitioning | **Campaign-to-Activation** | 12-20% | FI is running targeted outreach AND has some activation-level traffic. The mix is shifting toward higher motivation. |
| Mid | **Campaign** | 8-11% | Cardholder was prompted via SMS, email, or targeted notification. Manufactured motivation. ~1 in 10 acts. |
| Emerging | **Discovery-to-Campaign** | 3-7% | FI is beginning outreach but most traffic is still incidental. Early campaign momentum visible. |
| Starting | **Organic Discovery** | Below 3% | Cardholder found CardUpdatr while browsing online banking. No prompt, no urgency — curiosity only. This is a starting line, not a ceiling. |

### Why tiers instead of just showing the number?

A partner seeing "4.2% success rate" doesn't know if that's good or bad. But telling them *"You're in the Campaign tier — your cardholders are responding to outreach, and FIs in the Activation tier see 5x higher conversion"* gives them context, a benchmark, and a path forward.

### Why "Organic Discovery" instead of "Low Performing"?

Framing matters. A Tier 3 FI hasn't failed — they haven't started. The traffic they're seeing is cardholders who stumbled across CardUpdatr with no prompt. The gap between Discovery and Activation isn't a quality problem, it's a distribution problem. The name "Organic Discovery" signals: *this is what happens naturally; the opportunity is what happens with intentional placement.*

---

## Integration Types

| Term | What It Means | Why It Matters |
|---|---|---|
| **Pre-Authenticated (SSO)** | Cardholder launches CardUpdatr from within online banking. They're already logged in — no card number entry required. | Lowest friction path. Most FIs use this. Success rate benchmarks are based on this integration type. |
| **Direct Link** | Cardholder reaches CardUpdatr via a URL (from an email, SMS, QR code, or web page). They enter their card information manually before seeing merchants. | Higher friction, but every visitor is already committed (they chose to enter their card). Success rate thresholds are shifted higher because the "browse and leave" segment is filtered out by design. |

### Why not just "SSO" and "Non-SSO"?

"SSO" (Single Sign-On) is a technical infrastructure term. A partner executive doesn't need to know about authentication protocols — they need to know *how their cardholders get to CardUpdatr*. "Pre-Authenticated" and "Direct Link" describe the cardholder experience, not the plumbing.

---

## Engagement Score

A composite 0-100 score shown on the Portfolio and Executive dashboards that captures overall FI health at a glance.

**Components:**
- **Success Rate** (40%) — Are card updates working?
- **Trend** (20%) — Is performance improving or declining?
- **Reach** (20%) — What share of cardholders are encountering CardUpdatr?
- **Volume** (20%) — Is there meaningful activity?

### Why a composite score?

An FI can have a great success rate but terrible reach (nobody's using it). Or high volume but declining trends. The score surfaces problems that individual metrics hide. It's designed to answer: *"Which FIs need attention?"* — not to replace the individual metrics.

---

## Quick Translation Table

For anyone switching between internal engineering discussions and partner-facing materials:

| Internal / Technical | Partner-Facing | Notes |
|---|---|---|
| Session | Visit | Same thing, different audience |
| SM Session | Visit (at Merchant Selection) | "SM" = Select Merchant. Never use in partner materials. |
| CE Session | Credential Entry Session | "CE" is internal shorthand. Spell it out. |
| Job / Placement | Card Update | CardSavr API terminology vs. plain English |
| Successful Placement | Successful Card Update | |
| UDF / User Data Failure | Cardholder-Caused Issue | Wrong password, timeout, cancellation, etc. |
| SSO | Pre-Authenticated | Describe the experience, not the protocol |
| Non-SSO | Direct Link | |
| Tier 1 / T1 | Activation | Use the name, not the number, externally |
| Tier 2 / T2 | Campaign | |
| Tier 3 / T3 | Organic Discovery | |
| Tier 1.5 / 2.5 | Transition tiers (Campaign-to-Activation, Discovery-to-Campaign) | Numbers with decimals are internal-only |
| FI Funnel | Conversion Funnel | "FI" adds nothing in context |
| Engagement Score | Performance Score or Engagement Score | Both acceptable; always show component breakdown |
| GA | Google Analytics | Never abbreviate in partner materials |

---

## Principles Behind the Vocabulary

1. **Lead with the cardholder experience, not the system.** Partners care about what their cardholders do, not what our API calls it.

2. **Name the outcome, not the mechanism.** "Card Successfully Updated" beats "Successful Placement Job" every time.

3. **Context over precision.** A motivation tier name like "Activation" carries more meaning than "21-27% session success rate" even though the number is more precise.

4. **Internal shorthand is fine — internally.** SM, CE, UDF, T1.5 — these are efficient for the engineering and ops team. They just shouldn't leak into what partners see.

5. **Framing drives behavior.** "Organic Discovery" invites a conversation about distribution strategy. "Low Performing" invites defensiveness. We chose every term to open doors, not close them.

---

*Last updated: April 15, 2026*
