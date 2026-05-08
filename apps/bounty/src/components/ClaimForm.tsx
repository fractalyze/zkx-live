import { FormEvent, useState } from 'react';

type Props = {
    onSubmit: (input: { recipient: string }) => void;
    disabled?: boolean;
};

export function ClaimForm({ onSubmit, disabled = false }: Props) {
    const [recipient, setRecipient] = useState('');

    const valid = !disabled && recipient.trim().length >= 32;

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!valid) return;
        onSubmit({ recipient: recipient.trim() });
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
                <div className="text-sm text-muted">Solana address (where to receive)</div>
                <input
                    type="text"
                    placeholder="HJ7K...xY4M"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 px-4 py-3 outline-none transition focus:border-accent font-mono text-sm"
                    spellCheck={false}
                    autoComplete="off"
                    disabled={disabled}
                />
            </label>

            <button
                type="submit"
                disabled={!valid}
                className="w-full rounded-xl bg-accent px-6 py-4 text-lg font-semibold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted/30 disabled:text-muted"
            >
                ⭐ Star and claim
            </button>
        </form>
    );
}
