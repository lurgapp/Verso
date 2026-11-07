'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main style={{maxWidth:740,margin:'20vh auto',padding:24}}><h1>Something interrupted your story.</h1><p>Your saved draft stays on this device. Please try again.</p><button onClick={reset}>Try again</button></main>;}
