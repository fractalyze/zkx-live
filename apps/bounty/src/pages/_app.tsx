import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
    return (
        <>
            <Head>
                <title>zkx-live bounty</title>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <meta
                    name="description"
                    content="Star a repo, get paid on Solana. Real-time ZK proofs by zkX."
                />
            </Head>
            <Component {...pageProps} />
        </>
    );
}
