import { FormEvent, useState } from 'react';

type Props = {
    onSubmit: (input: { username: string; recipient: string }) => void;
};

export function ClaimForm({ onSubmit }: Props) {
    const [username, setUsername] = useState('');
    const [recipient, setRecipient] = useState('');

    const valid = username.trim().length > 0 && recipient.trim().length >= 32;

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        if (!valid) return;
        onSubmit({ username: username.trim(), recipient: recipient.trim() });
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <Field
                label="GitHub username"
                placeholder="octocat"
                value={username}
                onChange={setUsername}
            />
            <Field
                label="Solana address (where to receive)"
                placeholder="HJ7K...xY4M"
                value={recipient}
                onChange={setRecipient}
                mono
            />

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

function Field({
    label,
    placeholder,
    value,
    onChange,
    mono = false,
}: {
    label: string;
    placeholder: string;
    value: string;
    onChange: (v: string) => void;
    mono?: boolean;
}) {
    return (
        <label className="block">
            <div className="text-sm text-muted">{label}</div>
            <input
                type="text"
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className={
                    'mt-1 w-full rounded-lg border border-white/10 px-4 py-3 outline-none transition focus:border-accent ' +
                    (mono ? 'font-mono text-sm' : '')
                }
                spellCheck={false}
                autoComplete="off"
            />
        </label>
    );
}
