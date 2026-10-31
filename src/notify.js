// Telling a person that something is waiting for them.
//
// A gate nobody is told about is just a queue that stopped. The notifier is
// deliberately an interface rather than a feature: the engine calls notify()
// exactly once per approval request, and what that does is somebody else's
// decision. Slack, a pager, an email, a log line.

const silent = () => ({ name: 'silent', notify() {} });

const consoleNotifier = (out = console) => ({
  name: 'console',
  notify({ approval, job }) {
    out.log(`[approval] #${approval.id} ${job.type} needs a person: ${approval.reason}`);
  },
});

// Reuses the idempotent email connector, keyed on the approval, so a retry
// storm cannot turn into a mailbox full of the same alert.
const emailNotifier = (email, to) => ({
  name: 'email',
  notify({ approval, job }) {
    email.send({
      key: `approval-alert:${approval.id}`,
      to,
      subject: `Approval needed: ${job.type} (${approval.reason})`,
      kind: 'alert',
    });
  },
});

// Several at once; one throwing must not stop the others, and must never fail
// the job. A notification is not the work.
const fanout = (notifiers, onError = () => {}) => ({
  name: 'fanout',
  notify(event) {
    for (const n of notifiers) {
      try { n.notify(event); } catch (err) { onError(err, n); }
    }
  },
});

module.exports = { silent, consoleNotifier, emailNotifier, fanout };
