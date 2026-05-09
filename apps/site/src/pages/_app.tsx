import type { AppProps } from 'next/app';
import Head from 'next/head';
import '@/styles/globals.css';

export default function App({ Component, pageProps }: AppProps) {
    return (
        <>
            <Head>
                <title>zkx — real-time zero-knowledge proofs through a compiler</title>
                <meta
                    name="description"
                    content="zkx is an MLIR-based zero-knowledge optimization compiler. Bring any circuit, any proving scheme — get sub-second proofs on the hardware you have."
                />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <link rel="icon" href="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23ffffff'/%3E%3Ctext x='50' y='66' font-family='monospace' font-size='62' font-weight='700' text-anchor='middle' fill='%231f5fa8'%3Ezx%3C/text%3E%3C/svg%3E" />
            </Head>
            <Component {...pageProps} />
        </>
    );
}
