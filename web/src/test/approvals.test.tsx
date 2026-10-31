import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Approvals } from '../components/Approvals';
import type { Approval } from '../api/types';

const waiting: Approval = {
  id: 1,
  job_id: 7,
  type: 'payment.send',
  reason: '"payment.send" always needs a person',
  payload: { to: 'Acme Ltd', amount: 4820 },
  requested_at: Date.now() - 4000,
  expires_at: Date.now() + 60_000,
  draft: null,
};

describe('the approvals list', () => {
  test('sends the note and the reviewer with the decision', async () => {
    const onDecide = vi.fn().mockResolvedValue({ ok: true });
    render(<Approvals approvals={[waiting]} reviewer="ali" onDecide={onDecide} />);

    await userEvent.type(screen.getByLabelText('Note for approval 1'), 'invoice checked');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onDecide).toHaveBeenCalledWith(1, 'approve', 'invoice checked');
  });

  test('says who decided first when the server refuses a second decision', async () => {
    const onDecide = vi.fn().mockResolvedValue({ ok: false, conflict: true, status: 'approved', by: 'sam' });
    render(<Approvals approvals={[waiting]} reviewer="ali" onDecide={onDecide} />);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText(/Already approved by sam/)).toBeInTheDocument());
  });

  test('shows the draft and its sources when a model wrote one', () => {
    render(<Approvals
      approvals={[{ ...waiting, draft: { body: 'Hello Dana,\n\nYour invoice is being reissued.', model: 'mock', topic: 'invoices', sources: '["Invoices"]' } }]}
      reviewer="ali"
      onDecide={vi.fn()}
    />);

    expect(screen.getByText(/Your invoice is being reissued/)).toBeInTheDocument();
    expect(screen.getByText('written by mock')).toBeInTheDocument();
    expect(screen.getByText('sources: Invoices')).toBeInTheDocument();
  });

  test('says so plainly when nothing is waiting', () => {
    render(<Approvals approvals={[]} reviewer="ali" onDecide={vi.fn()} />);
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
  });
});
