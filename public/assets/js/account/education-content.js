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
 * Adding a lesson's content (Step 4) means adding an entry here keyed by
 * its slug — no new page, no template work. A slug with no entry renders
 * a graceful "coming soon" state, so partially-written curricula are fine.
 *
 * CONTENT GUARDRAILS (this is a credit-improvement product under CROA /
 * PIPEDA): lessons are EDUCATIONAL and factual — how things work, what
 * terms mean, general good practice. They must NOT promise specific score
 * outcomes, guarantee results, or give individualized financial/legal
 * advice. Frame tactics as "generally" / "for most people" and point
 * users to their own situation. Keep the editorial-financial voice:
 * clear, calm, jargon-free, no hype.
 *
 * Body format: an array of blocks. Supported block types:
 *   { h: 'Heading' }                  -> section heading
 *   { p: 'Paragraph text…' }          -> paragraph (inline <strong>/<em>
 *                                        and <a> are allowed in the string)
 *   { list: ['item', 'item'] }        -> unordered list
 *   { steps: ['first', 'second'] }    -> ordered list
 *   { callout: 'Key takeaway text' }  -> highlighted callout box
 *
 * The renderer escapes nothing in `p`/list/steps strings beyond what's
 * needed — keep them trusted, authored content (no user input here).
 */
(function () {
  'use strict';

  var CONTENT = {

    // ===================================================================
    // Chapter 1 · Lesson 1 — fully written (Step 3 proof-of-concept)
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
    }

    // Remaining lessons (Step 4) get their entries here, keyed by slug.
    // Any slug without an entry renders a graceful "coming soon" state.

  };

  window.iboostEducationContent = {
    get: function (slug) { return CONTENT[slug] || null; },
    has: function (slug) { return !!CONTENT[slug]; }
  };
})();
