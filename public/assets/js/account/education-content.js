/**
 * Education lesson CONTENT.
 *
 * Keyed by the registry slug. The lesson page (lesson.html +
 * education-lesson.js) reads its slug from ?slug=, looks up metadata in
 * the curriculum registry, and renders the body from here.
 *
 * Separation of concerns:
 *   education-curriculum.js  — structure (chapters, ids, titles, minutes,
 *                              order, gating). The single source of truth
 *                              for WHAT lessons exist.
 *   education-content.js     — the prose. The actual written lesson body.
 *
 * Adding a lesson's content means adding an entry here keyed by its slug
 * — no new page, no template work. A slug with no entry renders a
 * graceful "coming soon" state, so partially-written curricula are fine.
 *
 * CONTENT GUARDRAILS (this is a credit-improvement product under CROA /
 * PIPEDA): lessons are EDUCATIONAL and factual — how things work, what
 * terms mean, general good practice. They must NOT promise specific score
 * outcomes, guarantee results, or give individualized financial/legal
 * advice. Tactics are framed as "generally" / "for most people" and point
 * users to their own situation. Editorial-financial voice: clear, calm,
 * jargon-free, no hype.
 *
 * NOTE: These are FIRST DRAFTS pending review by Yan + partners before
 * launch. Numbers/thresholds that vary by lender or bureau are described
 * as general ranges, not guarantees. Anything region-specific notes
 * Canada vs US where it matters.
 *
 * Body format: an array of blocks. Supported block types:
 *   { h: 'Heading' }
 *   { p: 'Paragraph text…' }   (inline <strong>/<em>/<a> allowed)
 *   { list: ['item', 'item'] }
 *   { steps: ['first', 'second'] }
 *   { callout: 'Key takeaway text' }
 *
 * Pattern: IIFE, exposed via window.iboostEducationContent.
 */
(function () {
  'use strict';

  var CONTENT = {

    // ===================================================================
    // CHAPTER 1 — FOUNDATIONS
    // ===================================================================

    'what-a-credit-score-measures': {
      intro: 'Before you can improve a number, it helps to know exactly what it\u2019s measuring. A credit score isn\u2019t a judgment of you as a person \u2014 it\u2019s a prediction.',
      body: [
        { h: 'What the number is actually predicting' },
        { p: 'A credit score is a three-digit number, usually between 300 and 900 in Canada (300\u2013850 in the US), that lenders use to estimate one thing: <strong>how likely you are to repay borrowed money on time.</strong> That\u2019s it. It doesn\u2019t measure your income, your savings, your net worth, or how responsible you are in general \u2014 only your track record and current behaviour with credit.' },
        { p: 'Think of it like a weather forecast. A forecast doesn\u2019t know for certain whether it\u2019ll rain tomorrow; it looks at patterns and gives a probability. Your score does the same with repayment: it turns your credit history into a single number a lender can read in seconds.' },
        { callout: 'A higher score doesn\u2019t mean you\u2019re \u201Cgood with money.\u201D It means the data suggests a lower risk of missed payments. Those are different things \u2014 and that distinction is good news, because it means the score responds to specific, changeable behaviour.' },
        { h: 'Who calculates it' },
        { p: 'In Canada, two main credit bureaus \u2014 <strong>Equifax</strong> and <strong>TransUnion</strong> \u2014 collect information about your credit accounts from lenders. They each maintain a file on you, and a score is calculated from that file. Because the two bureaus don\u2019t always hold identical information, it\u2019s normal to have slightly different scores at each.' },
        { p: 'The lenders you borrow from report to these bureaus, usually monthly. Your file is a rolling record of that reported activity \u2014 which is why your score moves over time as new information comes in.' },
        { h: 'What goes into the file' },
        { p: 'Your credit file generally contains:' },
        { list: [
          'Your credit accounts (cards, loans, lines of credit) \u2014 when each was opened, the limit or original amount, and the current balance',
          'Your payment history on each account \u2014 whether payments arrived on time, and any that were late',
          'Recent applications for credit (these show up as \u201Cinquiries\u201D)',
          'Public-record items like bankruptcies or accounts sent to collections',
          'Basic identifying information \u2014 name, address history, date of birth'
        ] },
        { p: 'Notably, your file does <em>not</em> contain your salary, your bank balance, your job title, or your spending at specific stores. The score is built only from credit-related data.' },
        { h: 'Why it matters' },
        { p: 'The score is the gatekeeper for a lot of everyday financial life: whether you\u2019re approved for a card or loan, the interest rate you\u2019re offered, sometimes whether you\u2019re approved to rent an apartment or get a phone plan. A better score generally means access to more credit at lower cost \u2014 which, over a mortgage or car loan, can add up to real money.' },
        { p: 'The encouraging part: because the score is built from specific behaviours \u2014 paying on time, how much of your available credit you use, how long your accounts have been open \u2014 it\u2019s something you can influence. The rest of this chapter breaks down each of those levers.' },
        { callout: 'Takeaway: your credit score is a repayment-risk prediction built from your credit file at Equifax and TransUnion. It doesn\u2019t measure income or character \u2014 only credit behaviour. That\u2019s why it can be improved deliberately.' }
      ]
    },

    'five-factors-ranked': {
      intro: 'Your score isn\u2019t a mystery formula. It\u2019s built from five categories of information \u2014 and they don\u2019t carry equal weight. Knowing which matter most tells you where to focus.',
      body: [
        { h: 'The five factors' },
        { p: 'Most scoring models weigh roughly the same five things. The exact percentages vary by model and bureau, but the <em>order</em> is remarkably consistent. From most to least influential:' },
        { h: '1. Payment history \u2014 the biggest factor' },
        { p: 'Whether you pay on time, every time. This is consistently the single largest piece of most scores. A long run of on-time payments builds the score steadily; a missed payment can set it back noticeably. Nothing else you do matters as much as paying on time.' },
        { h: '2. Amounts owed (credit utilization)' },
        { p: 'How much of your available credit you\u2019re using right now. Using a small share of your limits generally helps; running balances close to your limits generally hurts. This factor is powerful <em>and</em> fast-moving \u2014 it can change month to month, which makes it the most actionable lever in the short term. There\u2019s a whole lesson on it next.' },
        { h: '3. Length of credit history' },
        { p: 'How long your accounts have been open, and the average age across them. Older is better. This is why closing your oldest card can backfire, and why time itself quietly improves your score as accounts age.' },
        { h: '4. Credit mix' },
        { p: 'The variety of credit types you manage \u2014 revolving (cards) versus instalment (loans). A mix can help modestly, but this is a minor factor. It\u2019s not worth taking on a loan you don\u2019t need just to \u201Cdiversify.\u201D' },
        { h: '5. New credit / inquiries' },
        { p: 'How many new accounts and applications you\u2019ve had recently. A burst of applications in a short window can ding the score temporarily, because it can signal risk. This is the smallest factor and tends to recover with time.' },
        { callout: 'Where to focus: the top two \u2014 payment history and utilization \u2014 drive the large majority of your score and are the most within your control. The bottom three matter, but chasing them is rarely worth much effort.' },
        { h: 'A useful way to think about it' },
        { p: 'Payment history is the foundation; you protect it by never missing a due date. Utilization is the dial you can turn quickly. The other three mostly reward patience and leaving good accounts alone. If you do nothing else, get those top two right.' }
      ]
    },

    'utilization-calculated': {
      intro: 'Credit utilization is the most misunderstood number in credit \u2014 and one of the most powerful. The good news: once you see how it\u2019s calculated, it becomes one of the easiest levers to pull.',
      body: [
        { h: 'The basic formula' },
        { p: 'Utilization is simply how much of your available revolving credit you\u2019re using, expressed as a percentage:' },
        { callout: 'Utilization = balance \u00F7 credit limit. A $300 balance on a $1,000 limit is 30% utilization.' },
        { p: 'It applies to revolving credit \u2014 credit cards and lines of credit \u2014 not to instalment loans like a car loan or mortgage. It\u2019s measured both per-card and across all your revolving accounts combined.' },
        { h: 'Lower is generally better' },
        { p: 'As a general rule, lower utilization is read as lower risk. Many people see meaningful benefit from keeping utilization in the low double digits or below. Maxing out a card \u2014 sitting near 100% \u2014 is one of the things that weighs most heavily against a score, even if you always pay on time.' },
        { p: 'It\u2019s not about carrying a balance or paying interest. You can use a card heavily and pay it in full and still show high utilization, because of <em>when</em> the number is measured.' },
        { h: 'The timing trick most people miss' },
        { p: 'Here\u2019s the part that surprises people. Utilization is usually measured from the balance reported on your <strong>statement date</strong> \u2014 not your payment due date. The card issuer reports your statement balance to the bureau. So even if you pay in full every month, if you charge a lot before the statement closes, a high balance gets reported.' },
        { steps: [
          'Your statement closes on, say, the 3rd \u2014 whatever balance is showing that day is what typically gets reported.',
          'Your payment is due later, around the 28th.',
          'If you pay down the balance <em>before</em> the statement closes, a lower number gets reported \u2014 and your utilization looks lower.'
        ] },
        { p: 'This means two people who spend identically can show very different utilization, purely based on timing. The next chapter\u2019s lesson on <em>when</em> to pay your card builds directly on this.' },
        { h: 'Per-card vs overall' },
        { p: 'Both matter. One card near its limit can weigh on your score even if your overall utilization is low. Spreading balances across cards, or paying down the most-utilized card first, can help the per-card picture.' },
        { callout: 'Takeaway: utilization = balance \u00F7 limit, measured at statement time. It\u2019s powerful and it moves fast, which makes it the best short-term lever you have. Lower, and paid before the statement closes, generally helps most.' }
      ]
    },

    'hard-vs-soft-pulls': {
      intro: 'Not every check of your credit affects your score. Knowing the difference between a hard pull and a soft pull keeps you from worrying about the harmless ones \u2014 and being careless with the ones that count.',
      body: [
        { h: 'Two kinds of credit checks' },
        { p: 'Any time someone looks at your credit file, it\u2019s recorded as an inquiry. There are two types, and only one affects your score.' },
        { h: 'Soft pulls \u2014 no score impact' },
        { p: 'A soft pull (or soft inquiry) happens when your credit is checked but <strong>not</strong> as part of you applying to borrow. These don\u2019t affect your score at all. Examples:' },
        { list: [
          'Checking your own credit score (including through a service like this one)',
          'A lender pre-screening you for an offer you didn\u2019t apply for',
          'An existing lender reviewing your account',
          'Some background or identity checks'
        ] },
        { p: 'You can check your own credit as often as you like. It is a soft pull every time and will never lower your score \u2014 a myth worth putting to rest.' },
        { h: 'Hard pulls \u2014 a small, temporary impact' },
        { p: 'A hard pull (or hard inquiry) happens when you <em>apply</em> for credit and the lender checks your file to make a decision \u2014 a new credit card, a loan, a mortgage, sometimes a rental or phone contract. A hard pull can lower your score modestly, usually for a short period, and it stays visible on your report for a while even after the score effect fades.' },
        { p: 'One hard pull is generally minor. The concern is many in a short window, which can suggest you\u2019re taking on risk quickly.' },
        { h: 'The rate-shopping exception' },
        { p: 'Scoring models generally understand that shopping for one loan \u2014 say a mortgage or car loan \u2014 means several lenders checking your file in a short span. Many models group similar inquiries within a short window (often a couple of weeks) so that rate-shopping for a single loan counts as roughly one inquiry, not many. So comparing offers for the same loan is usually fine.' },
        { callout: 'Takeaway: checking your own credit is always a soft pull \u2014 do it freely. Applying for new credit is a hard pull \u2014 minor on its own, but space out applications you don\u2019t need, and don\u2019t fear comparing rates for the same loan.' }
      ]
    },

    'reading-your-report': {
      intro: 'Your credit report can look like a wall of codes and dates. But it\u2019s organized into a handful of sections, and once you know what each one is telling you, it stops being intimidating.',
      body: [
        { h: 'Report vs score' },
        { p: 'First, a distinction. Your credit <strong>report</strong> is the detailed file \u2014 every account, payment, and inquiry. Your credit <strong>score</strong> is a number calculated from that report. The report is the raw material; the score is the summary. When you want to understand <em>why</em> your score is what it is, you read the report.' },
        { h: 'The main sections' },
        { p: 'Most reports are organized into these parts:' },
        { h: 'Personal information' },
        { p: 'Your name, current and past addresses, date of birth, and sometimes employment. Worth a glance: errors here (an address you never lived at, a misspelled name) can sometimes signal mixed files or, rarely, fraud.' },
        { h: 'Accounts (or \u201Ctradelines\u201D)' },
        { p: 'The heart of the report. Each credit account shows the type, the date opened, the limit or loan amount, the current balance, and a month-by-month payment history. This is where you\u2019ll see on-time payments \u2014 and any that were late, usually marked by how many days late they went (30, 60, 90+).' },
        { h: 'Inquiries' },
        { p: 'A list of who checked your credit and when. Hard inquiries (from your applications) and soft inquiries (everything else) are usually listed separately. Only the hard ones affected your score.' },
        { h: 'Public records and collections' },
        { p: 'Items like bankruptcies, or accounts that were sent to a collection agency. These are the most serious negative items and tend to weigh heavily.' },
        { h: 'How to read it without panicking' },
        { p: 'Go section by section, slowly. Most of what you see will be routine. Focus your attention on three things:' },
        { steps: [
          'Late-payment marks \u2014 are they accurate? A late payment you actually made on time is worth disputing (there\u2019s a lesson on that).',
          'Accounts you don\u2019t recognize \u2014 these can be errors or, occasionally, fraud, and are worth investigating.',
          'Balances and limits \u2014 do they look right? Outdated limits can distort your utilization.'
        ] },
        { callout: 'Takeaway: the report is just a few sections \u2014 personal info, accounts, inquiries, and public records/collections. Read it section by section, and focus on what\u2019s inaccurate or unfamiliar. You\u2019re reviewing for errors, not bracing for a verdict.' },
        { p: 'In Canada you\u2019re entitled to request your credit report from each bureau. Reviewing it periodically is one of the simplest habits for catching problems early.' }
      ]
    },

    'credit-canada-vs-us': {
      intro: 'If you\u2019ve moved between Canada and the US \u2014 or read US credit advice online while living in Canada \u2014 some of it won\u2019t quite fit. The systems rhyme, but they don\u2019t match. Here\u2019s what actually differs.',
      body: [
        { h: 'The big one: credit does not cross the border' },
        { p: 'This catches many newcomers off guard. Your credit history in one country generally <strong>does not transfer</strong> to the other. Someone with an excellent decades-long file in the US can arrive in Canada and effectively start from zero. The bureaus operate separately in each country, and a lender in one can\u2019t see your file in the other.' },
        { callout: 'If you\u2019re new to Canada (or new to the US), expect to build a fresh credit history from scratch, regardless of how strong your record was back home. It\u2019s frustrating, but it\u2019s normal \u2014 and it\u2019s buildable.' },
        { h: 'Score ranges differ' },
        { p: 'In Canada, common score ranges run roughly 300\u2013900. In the US, the most familiar ranges run 300\u2013850. So a \u201Cgood\u201D number isn\u2019t directly comparable across the two \u2014 the scales are different.' },
        { h: 'Same bureaus, different scope' },
        { p: 'Equifax and TransUnion operate in both countries, but as separate national operations with separate data. (The US also has Experian as a major third bureau; its consumer presence in Canada is more limited.) So \u201Ccheck all your bureaus\u201D means different things depending on where you are.' },
        { h: 'What\u2019s the same' },
        { p: 'The fundamentals carry over. In both countries, paying on time and keeping utilization low are the dominant levers. The five-factor framework holds. The mechanics of statements, due dates, hard versus soft pulls \u2014 all broadly similar. So the <em>habits</em> you learn here work on either side of the border; it\u2019s the <em>files</em> that don\u2019t travel.' },
        { h: 'Building credit as a newcomer' },
        { p: 'Generally, the path to building a fresh file looks similar in both countries: start with an accessible product (such as a secured card or an entry-level account), use it lightly, pay it on time, and let history accumulate. The lesson on thin files covers this in more depth.' },
        { callout: 'Takeaway: credit history doesn\u2019t cross the border, and the score scales differ (Canada ~300\u2013900, US 300\u2013850). But the core habits \u2014 pay on time, keep utilization low \u2014 are universal. If you\u2019ve relocated, plan to rebuild, not transfer.' }
      ]
    },

    // ===================================================================
    // CHAPTER 2 — THE FAST LEVERS
    // ===================================================================

    'when-to-pay-your-card': {
      intro: 'Most people think paying their card on time is the whole game. Paying on time is essential \u2014 but <em>when</em> in the cycle you pay can change how your credit looks, even if your spending never changes.',
      body: [
        { h: 'Two dates that aren\u2019t the same' },
        { p: 'Every credit card has two key dates each month, and confusing them is common:' },
        { list: [
          '<strong>Statement (closing) date</strong> \u2014 the day your billing cycle ends and your statement is generated. The balance on this day is typically what the card reports to the credit bureau.',
          '<strong>Due date</strong> \u2014 the day your minimum payment must arrive to avoid a late mark and interest. Usually a few weeks after the statement date.'
        ] },
        { p: 'Paying by the due date is what protects your payment history \u2014 the most important factor. But the balance reported to the bureau is usually snapshotted at the <em>statement</em> date. That gap is the lever.' },
        { h: 'Why this matters for utilization' },
        { p: 'Recall that utilization = balance \u00F7 limit, measured from the reported balance. If you charge heavily and let the statement close on a big balance, high utilization gets reported \u2014 even if you then pay it all off by the due date and never owe a cent of interest.' },
        { h: 'The timing approach' },
        { p: 'For many people, the practical takeaway is:' },
        { steps: [
          'Always pay at least the minimum by the <strong>due date</strong> \u2014 this is non-negotiable; it protects payment history and avoids interest and fees.',
          'If you want lower reported utilization, consider paying down the balance <em>before</em> the <strong>statement date</strong>, so a smaller number gets reported.',
          'Some people make an extra mid-cycle payment for exactly this reason \u2014 it keeps the reported balance low without changing what they actually spend.'
        ] },
        { callout: 'Paying by the due date protects your payment history. Paying before the statement date shapes your reported utilization. They\u2019re two different goals served by two different dates.' },
        { h: 'A note on interest' },
        { p: 'To avoid interest on purchases, the general rule is to pay your <em>statement balance in full</em> by the due date each month. Paying early to manage utilization doesn\u2019t change that \u2014 just make sure whatever remains at the due date is covered.' },
        { p: 'None of this requires spending less or carrying a balance. It\u2019s the same money, timed with awareness of when the snapshot is taken.' }
      ]
    },

    'credit-limit-increase': {
      intro: 'Asking for a higher limit can help your utilization without you spending or paying any differently \u2014 because if your balance stays the same and your limit goes up, your utilization goes down. But there\u2019s a right way to ask.',
      body: [
        { h: 'Why a higher limit can help' },
        { p: 'Utilization is balance \u00F7 limit. Raise the limit and \u2014 assuming your balance doesn\u2019t rise to match \u2014 the ratio drops. Example: a $500 balance on a $1,000 limit is 50%. The same $500 on a $2,000 limit is 25%. Same spending, lower utilization, purely from the larger denominator.' },
        { callout: 'The benefit only holds if your spending stays put. A higher limit that you proceed to fill up doesn\u2019t help \u2014 it can hurt. The tactic works for people whose balances are already under control.' },
        { h: 'Soft pull or hard pull?' },
        { p: 'This is the key question to ask before requesting. Some issuers grant a limit increase with a <strong>soft</strong> pull (no score impact); others run a <strong>hard</strong> pull (a small, temporary impact). Policies vary by issuer and over time. It\u2019s reasonable to ask the issuer which kind of inquiry a request will trigger before you proceed.' },
        { h: 'How to ask' },
        { steps: [
          'Many issuers let you request an increase in-app or online \u2014 often the simplest route.',
          'Before requesting, check (or ask) whether it triggers a hard or soft pull.',
          'A stronger case generally helps: a history of on-time payments, perhaps a rise in income since you opened the account, and not having asked very recently.',
          'If declined, that\u2019s okay \u2014 you can usually try again later once more positive history has built.'
        ] },
        { h: 'Things to keep in mind' },
        { p: 'A higher limit is a tool, not free money. The point is the improved ratio, not the extra spending room. For someone working to keep balances low, a limit increase obtained the right way can be one of the cleaner utilization wins available \u2014 because it requires no change in behaviour, only a larger denominator.' },
        { callout: 'Takeaway: a higher limit lowers utilization if your balance holds steady. Ask whether the request is a soft or hard pull first, make the request when your history is strong, and resist the urge to spend into the new room.' }
      ]
    },

    'disputing-an-error': {
      intro: 'Credit reports contain mistakes more often than people expect \u2014 a payment marked late that wasn\u2019t, an account that isn\u2019t yours, an outdated balance. You have the right to dispute errors, and correcting them can matter.',
      body: [
        { h: 'Why errors are worth catching' },
        { p: 'Because your score is built from your report, an error in the report can drag down the score for no real reason. A single late-payment mark that shouldn\u2019t be there, or an account that isn\u2019t yours, can have an outsized effect \u2014 especially since payment history is the biggest factor.' },
        { h: 'Common errors to look for' },
        { list: [
          'A payment reported late that you actually made on time',
          'An account that isn\u2019t yours (possible mixed file, or fraud)',
          'A balance or credit limit that\u2019s wrong or out of date',
          'A debt shown as unpaid that you\u2019ve already settled',
          'Duplicate listings of the same account',
          'Outdated negative items that should have aged off'
        ] },
        { h: 'How the dispute process generally works' },
        { p: 'In both Canada and the US, you have the right to dispute information you believe is inaccurate, and the bureau is required to investigate. The general shape of the process:' },
        { steps: [
          'Get your report and identify the specific item you believe is wrong.',
          'File a dispute with the credit bureau reporting it (Equifax and/or TransUnion). Each bureau has a process for this \u2014 online, by mail, or by phone.',
          'Provide any supporting documentation you have (statements, payment confirmations, letters).',
          'The bureau investigates with the lender that reported the item, and responds within the timeframe set by law.',
          'If the item is found to be inaccurate, it\u2019s corrected or removed. If you disagree with the outcome, you generally have further options, including adding a statement to your file.'
        ] },
        { callout: 'A dispute is for information that is genuinely inaccurate, incomplete, or outdated. Accurate negative information \u2014 a payment you really did miss \u2014 generally can\u2019t be disputed away; it ages off over time instead.' },
        { h: 'A caution about \u201Ccredit repair\u201D promises' },
        { p: 'Be wary of anyone promising to \u201Cdelete\u201D accurate negative items or guaranteeing a specific score jump for a fee. You can dispute genuine errors yourself, at no cost, directly with the bureaus. There\u2019s a dedicated lesson on spotting credit-repair scams.' },
        { p: 'This lesson is general information, not legal advice \u2014 if you\u2019re dealing with a complex or contested item, you may want guidance specific to your situation.' }
      ]
    },

    'thin-file-quick-wins': {
      intro: 'A \u201Cthin file\u201D means you don\u2019t have much credit history yet \u2014 common for newcomers, young adults, or anyone who\u2019s avoided credit. The challenge: you need credit to build credit. Here are the usual on-ramps.',
      body: [
        { h: 'What a thin file is' },
        { p: 'Scoring models need data to work with. If you have few or no accounts, there isn\u2019t enough history to generate a strong score \u2014 or sometimes any score at all. This isn\u2019t a bad mark; it\u2019s an empty page. The goal is simply to start writing on it, responsibly.' },
        { h: 'Common starting points' },
        { p: 'These are typical tools people use to begin building a file. Availability and terms vary by lender and country.' },
        { h: 'Secured credit cards' },
        { p: 'A secured card requires a refundable deposit that usually sets your limit. Because the deposit reduces the lender\u2019s risk, these are generally accessible even with no history. Used lightly and paid on time, a secured card reports to the bureaus like any card and builds history. Many people later graduate to a standard card.' },
        { h: 'Becoming an authorized user' },
        { p: 'A family member or trusted person can add you as an authorized user on their card. If the account is well-managed, its history may report on your file too. The flip side: if they mismanage it, that can affect you \u2014 so it depends entirely on the primary account holder\u2019s habits.' },
        { h: 'Credit-builder products' },
        { p: 'Some lenders offer products specifically designed to build credit \u2014 for example, small instalment arrangements where your on-time payments are reported. Terms vary; read them carefully and confirm the product actually reports to the bureaus, since one that doesn\u2019t report won\u2019t build anything.' },
        { h: 'The habits that make any of them work' },
        { steps: [
          'Use the account \u2014 a card that sits unused builds little. Small, regular purchases are enough.',
          'Pay on time, every time \u2014 this is the foundation of the whole file.',
          'Keep utilization low \u2014 don\u2019t run the limit up just because it\u2019s there.',
          'Be patient \u2014 history is partly about time. A few months in, a file starts to take shape; longer is better.'
        ] },
        { callout: 'Takeaway: building from a thin file usually means starting with an accessible product (often a secured card), using it lightly, and paying on time while history accumulates. The tool matters less than the habit \u2014 and confirm anything you use actually reports to the bureaus.' }
      ]
    },

    // ===================================================================
    // CHAPTER 3 — BUILDING & SUSTAINING
    // ===================================================================

    'history-that-compounds': {
      intro: 'A lot of credit improvement is fast \u2014 utilization can shift in a month. But the deepest, most durable gains come from history, and history only does one thing: it accumulates. Time is a lever too; it just works quietly.',
      body: [
        { h: 'Why age matters' },
        { p: 'Length of credit history is one of the five factors. Scoring models generally reward a longer track record and a higher average account age, because more history means a more reliable prediction. You can\u2019t rush this \u2014 but you can avoid sabotaging it, and you can set it up to compound.' },
        { h: 'The compounding effect' },
        { p: 'Every month you keep good accounts open and in good standing, two things happen: your average account age ticks up, and your record of on-time payments grows longer. Neither is dramatic in any single month, but over years they become the backbone of a strong score \u2014 the part that\u2019s hard for a setback to undo.' },
        { callout: 'Think of your oldest accounts as the roots of your file. They don\u2019t need attention \u2014 they just need to stay in the ground. The longer they\u2019re there, the more stable everything above them becomes.' },
        { h: 'Protecting your history' },
        { list: [
          'Keep old accounts open when reasonable \u2014 especially your oldest. Closing your longest-held card can lower your average age and reduce available credit at once.',
          'If a card has no annual fee, there\u2019s often little harm in keeping it open and using it occasionally to keep it active.',
          'Avoid opening many new accounts in a short span \u2014 each new account lowers your average age and the newness counts against you briefly.'
        ] },
        { h: 'The patient mindset' },
        { p: 'Once your payment history and utilization are in good shape, much of what remains is simply <em>not interfering</em>. Let good accounts age. Keep paying on time. Resist the urge to constantly open and close things. The file strengthens on its own.' },
        { p: 'This is also why starting sooner helps \u2014 not because anything is urgent, but because the clock that builds history only runs while accounts are open.' },
        { callout: 'Takeaway: history compounds. Keep good accounts \u2014 especially old ones \u2014 open and in good standing, avoid churn, and let time do work that no quick tactic can replicate.' }
      ]
    },

    'new-accounts-and-closures': {
      intro: 'Opening and closing accounts both move your score, sometimes in ways that feel counterintuitive \u2014 like closing a paid-off card actually hurting. Here\u2019s what each action does and why.',
      body: [
        { h: 'What opening a new account does' },
        { p: 'Opening a new credit account generally has a few short-term effects:' },
        { list: [
          'A hard inquiry from the application \u2014 small and temporary.',
          'It lowers your average account age, because a brand-new account drags the average down.',
          'It adds available credit, which can <em>lower</em> your overall utilization \u2014 a potential plus.'
        ] },
        { p: 'So a new account is a mix: a small short-term cost (inquiry + younger average age) against a possible utilization benefit. One new account when you have a reason for it is generally minor. Several at once is what tends to weigh more.' },
        { h: 'What closing an account does' },
        { p: 'Closing a card can feel responsible \u2014 but it can work against your score in two ways:' },
        { steps: [
          'It removes that card\u2019s limit from your available credit, which <em>raises</em> your overall utilization (your balances are now divided by a smaller total limit).',
          'Over time it can reduce your average account age, especially if it was an older card \u2014 and eventually the positive history may no longer help as it ages off.'
        ] },
        { callout: 'The counterintuitive part: paying off a card and then closing it can lower your score, because you\u2019ve removed available credit and, eventually, history. Paid off doesn\u2019t always mean close it.' },
        { h: 'When closing can still make sense' },
        { p: 'None of this means never close anything. There are good reasons \u2014 a high annual fee you don\u2019t use, a card tempting you to overspend, simplifying your finances, or a problematic account. The point is to close with awareness of the trade-off, not on the assumption that fewer cards is automatically \u201Cbetter\u201D for your score.' },
        { p: 'If you do close one, closing a newer card generally costs less history than closing your oldest. And paying down balances elsewhere first can blunt the utilization jump.' },
        { callout: 'Takeaway: opening adds an inquiry and lowers average age but can help utilization; closing removes available credit (raising utilization) and eventually history. Open when you have a reason, and think twice before closing old, no-fee cards.' }
      ]
    },

    'recovering-after-a-miss': {
      intro: 'A missed payment or an account in collections feels like a permanent black mark. It isn\u2019t. Negative items fade, and there are constructive steps you can take. Recovery is slower than damage \u2014 but it\u2019s real.',
      body: [
        { h: 'First, the reassurance' },
        { p: 'A single missed payment, or even a rough patch, is not the end of your credit. Negative information doesn\u2019t stay forever \u2014 it ages off your report after a set period, and its weight on your score generally lessens over time even before it disappears. Meanwhile, new positive history starts counterbalancing it.' },
        { callout: 'Time moves in your favour here. The further a negative event recedes into the past, the less it generally weighs \u2014 and steady positive behaviour after it accelerates the recovery.' },
        { h: 'If you\u2019ve just missed a payment' },
        { steps: [
          'Bring the account current as soon as you can \u2014 the longer it stays unpaid, the more serious the mark (30 days late is less severe than 90+).',
          'Contact the lender. Some may, at their discretion, choose not to report a single isolated late payment, particularly if you have an otherwise good history \u2014 it\u2019s reasonable to ask, though they\u2019re not obligated.',
          'Set up safeguards so it doesn\u2019t repeat \u2014 reminders, or automatic minimum payments as a backstop.'
        ] },
        { h: 'If an account has gone to collections' },
        { p: 'A collection is more serious, but still recoverable. General points to understand:' },
        { list: [
          'Verify the debt is actually yours and the amount is correct before paying \u2014 errors happen, and you can dispute inaccurate collections.',
          'Understand what paying does: a paid collection is generally viewed more favourably than an unpaid one, though the record of it may remain until it ages off.',
          'Get any agreement about a collection account in writing before paying.',
          'Because the stakes and rules can be complex, this is an area where advice specific to your situation \u2014 and your province or state \u2014 is worth seeking.'
        ] },
        { h: 'Rebuilding after the fact' },
        { p: 'The rebuild looks like the build: keep current accounts in perfect standing, keep utilization low, and let time pass. Each on-time month adds positive history that dilutes the old negative. The score recovers gradually, then more noticeably as the negative item ages.' },
        { callout: 'Takeaway: missed payments and collections are setbacks, not permanent. Bring things current, address collections carefully (and get help for complex ones), then rebuild with on-time payments and low utilization. Time does the rest.' }
      ]
    },

    'avoiding-credit-scams': {
      intro: 'Where there\u2019s anxiety about credit, there are people selling shortcuts. Some \u201Ccredit repair\u201D offers are legitimate services; others are scams that charge for things you can do free, or promise things no one can deliver. Here\u2019s how to tell the difference.',
      body: [
        { h: 'The promises that should raise a flag' },
        { p: 'Be cautious of anyone who:' },
        { list: [
          'Guarantees a specific score increase, or a specific number, for a fee \u2014 no one can guarantee that.',
          'Claims they can remove <em>accurate</em> negative information from your report \u2014 accurate items generally can\u2019t be erased on demand; they age off over time.',
          'Asks for a large upfront fee before doing anything.',
          'Tells you not to contact the credit bureaus yourself.',
          'Suggests creating a \u201Cnew credit identity\u201D or using a different identifying number \u2014 this can be illegal.',
          'Pressures you to act immediately, or is vague about exactly what you\u2019re paying for.'
        ] },
        { callout: 'A simple test: if an offer promises to delete true information or guarantees a number, be skeptical. Legitimate help is transparent about what it can and can\u2019t do \u2014 and what it can do, you can often do yourself.' },
        { h: 'What you can do yourself, for free' },
        { p: 'Much of what some services charge for is available to you directly at no cost:' },
        { list: [
          'Request and review your own credit reports from the bureaus.',
          'Dispute genuine errors directly with Equifax or TransUnion.',
          'Build positive history through your own accounts and on-time payments.',
          'Wait out accurate negative items as they age off.'
        ] },
        { h: 'Where legitimate help fits' },
        { p: 'There are honest services and educational tools (including this one) that help you understand your file, organize your finances, and stay on track. The distinction is honesty about outcomes: a legitimate service helps you do the right things and understand your situation \u2014 it doesn\u2019t promise to make accurate bad history vanish or guarantee a magic number.' },
        { h: 'Protecting yourself' },
        { steps: [
          'Never pay a large upfront fee for vague \u201Crepair\u201D promises.',
          'Don\u2019t share sensitive personal information with an unsolicited \u201Crepair\u201D contact.',
          'Be especially wary of anything suggesting you misrepresent your identity.',
          'When in doubt, slow down \u2014 pressure to act fast is itself a warning sign.'
        ] },
        { callout: 'Takeaway: legitimate help is honest about limits; scams sell guarantees and deletions of true information. You can review your reports, dispute real errors, and build history yourself, for free. Guard your information and distrust urgency.' }
      ]
    },

    // ===================================================================
    // CHAPTER 4 — MORTGAGE READINESS (score-gated 700)
    // ===================================================================

    'beyond-the-score': {
      intro: 'When you apply for a mortgage, your credit score matters \u2014 but it\u2019s only one input. Lenders look at a fuller picture. Understanding what else they weigh helps you prepare the whole application, not just the number.',
      body: [
        { h: 'The score opens the door; the file walks through it' },
        { p: 'A strong score generally helps you qualify and can affect the rate you\u2019re offered. But mortgage lending involves a deeper review than a credit-card approval. Lenders are lending a large amount over a long time, so they look beyond the three-digit number.' },
        { h: 'What lenders generally also consider' },
        { list: [
          '<strong>Income and its stability</strong> \u2014 not just how much, but how reliable and how well-documented it is.',
          '<strong>Debt-to-income</strong> \u2014 how your existing obligations compare to your income (its own lesson follows).',
          '<strong>Down payment</strong> \u2014 how much you\u2019re putting in, and sometimes where it came from.',
          '<strong>Employment history</strong> \u2014 a steady record is generally viewed favourably.',
          '<strong>The full credit file</strong> \u2014 not just the score, but the detail: recent late payments, how much new credit you\u2019ve taken on, the mix and age of accounts.',
          '<strong>Savings and reserves</strong> \u2014 evidence you can handle payments and unexpected costs.'
        ] },
        { callout: 'A high score with a thin or shaky overall picture is weaker than it looks. Mortgage readiness is about the whole application hanging together \u2014 the score is necessary but not sufficient.' },
        { h: 'Why recent behaviour matters extra' },
        { p: 'Close to a mortgage application, lenders pay particular attention to recent activity. A flurry of new accounts, a rising balance, or a recent late payment can raise questions even if your long-term history is strong. The stretch before applying is a time to keep things steady, not to make big credit moves.' },
        { h: 'Preparing the whole picture' },
        { p: 'Getting mortgage-ready generally means tending to all of it: a strong score, a clean recent file, manageable debt relative to income, documented stable income, and savings. The next lessons go deeper on getting the file ready and on debt-to-income specifically.' },
        { p: 'This is general education, not mortgage or financial advice \u2014 specific lender requirements vary, and a mortgage professional can speak to your situation.' },
        { callout: 'Takeaway: the score gets you considered; income stability, debt-to-income, down payment, documented employment, savings, and the detail of your recent file decide the rest. Prepare the whole application, and keep recent activity calm.' }
      ]
    },

    'file-mortgage-ready': {
      intro: 'In the months before a mortgage application, there\u2019s a lot you can do to present the cleanest possible credit file \u2014 and a few common moves that quietly work against you. Preparation is mostly about steadiness.',
      body: [
        { h: 'The goal: a calm, clean recent file' },
        { p: 'Mortgage lenders scrutinize the recent stretch of your credit closely. The aim in the lead-up is a file that looks stable and low-risk: on-time payments, low utilization, no sudden changes, no surprises. Think of it as tidying before an inspection.' },
        { h: 'Generally helpful in the lead-up' },
        { list: [
          'Keep every payment on time \u2014 a recent late mark stands out most.',
          'Bring utilization down \u2014 lower balances relative to limits present well, and it\u2019s one of the faster things to improve.',
          'Review your reports for errors well ahead of applying, so there\u2019s time to dispute and resolve anything inaccurate.',
          'Keep your existing accounts open and stable \u2014 continuity reads as stability.',
          'Have your documentation in order \u2014 income, employment, and the source of your down payment.'
        ] },
        { h: 'Common moves to avoid before applying' },
        { steps: [
          'Opening new credit \u2014 a new card or loan adds an inquiry, lowers average account age, and introduces a fresh obligation right when the lender wants to see stability.',
          'Making a large purchase on credit \u2014 it spikes utilization and adds debt at the worst time.',
          'Closing old accounts \u2014 it can raise utilization and reduce history just before scrutiny.',
          'Taking on a co-signed obligation or big new commitment that changes your debt picture.',
          'Letting anything slip to late \u2014 even one missed payment can be costly this close to applying.'
        ] },
        { callout: 'The lead-up to a mortgage is a hold-steady period, not a build-aggressively one. The single best thing many people can do is simply not make sudden changes \u2014 no new accounts, no big purchases, no closures.' },
        { h: 'Give yourself runway' },
        { p: 'Because disputes take time to resolve and utilization changes take a cycle or two to report, it helps to start tidying the file well before you plan to apply rather than in the final weeks. Earlier preparation means fewer surprises.' },
        { p: 'As always, this is general guidance \u2014 a mortgage professional can advise on what a specific lender will want to see and when.' }
      ]
    },

    'debt-to-income': {
      intro: 'Debt-to-income is one of the numbers mortgage lenders care about most \u2014 and it\u2019s separate from your credit score. You can have a great score and still be turned down if this ratio is out of line. Here\u2019s how it works.',
      body: [
        { h: 'What debt-to-income is' },
        { p: 'Debt-to-income (DTI) compares how much you owe to how much you earn. Broadly, it asks: of your income, how much is already committed to debt? Lenders use it to judge whether you can comfortably take on a mortgage payment on top of your existing obligations.' },
        { callout: 'DTI is about capacity, not history. Your score says how reliably you\u2019ve repaid; DTI says how much room you have to repay more. A mortgage lender wants both to look good.' },
        { h: 'The two ratios lenders often use' },
        { p: 'Mortgage lending commonly looks at two related measures (the exact names and thresholds vary by country and lender):' },
        { list: [
          'A <strong>housing ratio</strong> \u2014 roughly, your expected housing costs compared to your income.',
          'A <strong>total debt ratio</strong> \u2014 your housing costs <em>plus</em> your other debt payments (cards, loans, lines of credit) compared to your income.'
        ] },
        { p: 'In Canada these are often discussed as GDS (Gross Debt Service) and TDS (Total Debt Service); in the US as front-end and back-end DTI. The idea is the same: lenders set limits on how high these ratios can go.' },
        { h: 'How to improve your DTI' },
        { p: 'Because DTI is a ratio of debt payments to income, you improve it by lowering the top or raising the bottom:' },
        { steps: [
          'Pay down existing debts \u2014 especially high-payment ones \u2014 to reduce your monthly obligations.',
          'Avoid taking on new debt before applying, which would add to the numerator.',
          'Increase documented income where possible \u2014 though lenders generally want stable, verifiable income, not one-off boosts.',
          'Be realistic about the housing cost you\u2019re targeting \u2014 a smaller payment keeps both ratios lower.'
        ] },
        { h: 'Why it sits alongside the score' },
        { p: 'A strong score and a healthy DTI tell a lender two different reassuring things: you repay reliably, and you have the capacity to take on more. Mortgage readiness generally means getting both in shape \u2014 which is why this chapter treats the score as the entry point, not the finish line.' },
        { callout: 'Takeaway: DTI compares your debt payments to your income and measures capacity, separate from your score. Lower it by reducing existing debt and avoiding new obligations before applying. Lenders want a good score and a healthy DTI together. This is general information, not mortgage advice.' }
      ]
    }

  };

  window.iboostEducationContent = {
    get: function (slug) { return CONTENT[slug] || null; },
    has: function (slug) { return !!CONTENT[slug]; }
  };
})();
