import { useState, type FormEvent } from 'react';
import {
  useAcceptHousehold, useDeclineHousehold, useHouseholdStatus, useInviteHousehold, useUnlinkHousehold,
} from '../api/queries.js';
import { Button, Card, ErrorNote, Field, Input, SuccessNote } from './ui.js';

/**
 * Settings card: invite/accept/decline/unlink a pairwise household link.
 * Only combined totals are ever shared between linked accounts — see the
 * "Me / Combined" toggle on the dashboard for the shared view itself.
 */
export function HouseholdSection() {
  const status = useHouseholdStatus();
  const invite = useInviteHousehold();
  const accept = useAcceptHousehold();
  const decline = useDeclineHousehold();
  const unlink = useUnlinkHousehold();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    invite.mutate(username.trim(), {
      onSuccess: () => setUsername(''),
      onError: (err) => setError(err instanceof Error ? err.message : 'Could not send invite'),
    });
  };

  const s = status.data;

  return (
    <Card className="p-5">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-400">Household</h2>
      <p className="mb-4 text-sm text-ink-400">
        Link with one other account to see a combined net worth on the
        dashboard. Only totals are shared — neither of you can see the
        other's individual assets or liabilities.
      </p>

      {error ? <div className="mb-3"><ErrorNote message={error} /></div> : null}

      {!s || s.state === 'none' ? (
        <form onSubmit={onInvite} className="space-y-4">
          <Field label="Username" hint="The account you want to link with.">
            {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value)} required />}
          </Field>
          <Button type="submit" className="w-full" disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
      ) : s.state === 'pending-sent' ? (
        <div className="space-y-3">
          <SuccessNote message={`Invite sent to ${s.partnerUsername} — waiting for them to accept.`} />
          <Button variant="danger" className="w-full" onClick={() => unlink.mutate(s.linkId!)} disabled={unlink.isPending}>
            Cancel invite
          </Button>
        </div>
      ) : s.state === 'pending-received' ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-100">{s.partnerUsername} wants to link households with you.</p>
          <div className="flex gap-3">
            <Button className="flex-1" onClick={() => accept.mutate(s.linkId!)} disabled={accept.isPending}>
              Accept
            </Button>
            <Button variant="ghost" className="flex-1" onClick={() => decline.mutate(s.linkId!)} disabled={decline.isPending}>
              Decline
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <SuccessNote message={`Linked with ${s.partnerUsername}. A "Combined" view is available on the dashboard.`} />
          <Button variant="danger" className="w-full" onClick={() => unlink.mutate(s.linkId!)} disabled={unlink.isPending}>
            Unlink
          </Button>
        </div>
      )}
    </Card>
  );
}
