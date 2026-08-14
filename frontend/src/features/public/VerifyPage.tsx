import { useState } from 'react';
import { api, unwrap } from '@/lib/api';

export function VerifyPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  async function verify() {
    setError('');
    setResult(null);
    try {
      const data = await unwrap<Record<string, unknown>>(api.get(`/exams/verify/${encodeURIComponent(code)}`));
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-3xl font-extrabold">Verify a Certificate / Report</h1>
      <p className="mt-2 text-slate-600">Enter the verification code printed on a SpeakEdge certificate or CEFR report.</p>
      <div className="card mt-6 space-y-4">
        <input
          className="input"
          placeholder="CERT-XXXXXXXXXX or CEFR-XXXXXXXXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <button className="btn-primary w-full" onClick={verify} disabled={!code}>
          Verify
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {result && (
          <div className={`rounded-lg p-4 text-sm ${result.valid ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            {result.valid ? (
              <>
                <div className="font-bold">✓ Valid {String(result.type)}</div>
                <pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(result, null, 2)}</pre>
              </>
            ) : (
              'No record found for this verification code.'
            )}
          </div>
        )}
      </div>
    </div>
  );
}
