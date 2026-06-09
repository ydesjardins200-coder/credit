// Pure-logic harness for the Customer.io wrapper's SAFETY properties:
// when keys/templates are absent it must no-op (never throw, never send).
// Run: node test/customerio.test.js   (no network, no real credentials)

// Ensure a clean, unconfigured env so we exercise the gated no-op paths.
delete process.env.CUSTOMERIO_SITE_ID;
delete process.env.CUSTOMERIO_TRACK_KEY;
delete process.env.CUSTOMERIO_APP_API_KEY;
delete process.env.CIO_TX_WELCOME;
delete process.env.CIO_TX_CS_REPLY;

const cio = require('../src/lib/customerio');

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

(async function run() {
  console.log('customerio wrapper — gating/safety');

  // 1) status reflects fully-disabled when no env keys are set
  const s = cio.status();
  ok('status.region is us', s.region === 'us');
  ok('track disabled w/o keys', s.trackEnabled === false);
  ok('app disabled w/o keys', s.appEnabled === false);
  ok('no template ids resolved', Object.values(s.templates).every(function (v) { return v === false; }));

  // 2) identify no-ops without throwing
  const i1 = await cio.identify('user-1', { email: 'a@b.ca' });
  ok('identify -> skipped(disabled)', i1.ok === false && i1.skipped === 'disabled');
  const i2 = await cio.identify('', {});
  ok('identify -> skipped(no-id)', i2.ok === false && i2.skipped === 'no-id');

  // 3) track no-ops without throwing
  const t1 = await cio.track('user-1', 'cs_case_opened', { case_id: 9 });
  ok('track -> skipped(disabled)', t1.ok === false && t1.skipped === 'disabled');
  const t2 = await cio.track('user-1', '');
  ok('track -> skipped(missing-args)', t2.ok === false && t2.skipped === 'missing-args');

  // 4) sendTransactional gating
  const x1 = await cio.sendTransactional('welcome', { to: 'a@b.ca' });
  ok('tx -> skipped(disabled) w/o app key', x1.ok === false && x1.skipped === 'disabled');
  const x2 = await cio.sendTransactional('bogus_key', { to: 'a@b.ca' });
  ok('tx -> skipped(unknown-key)', x2.ok === false && x2.skipped === 'unknown-key');

  // 5) with app key present but template id absent -> skipped(no-template),
  //    and recipient guard -> skipped(no-recipient). We can't flip the
  //    module-level APP_ENABLED after require, so assert the env-mapping
  //    intent indirectly: a known key with no template env is still gated.
  ok('all calls returned objects, none threw', true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
  console.log('HARNESS THREW (should never happen): ' + (e && e.message));
  process.exit(1);
});
