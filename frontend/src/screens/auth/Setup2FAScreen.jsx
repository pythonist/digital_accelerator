import React, { useState, useEffect } from 'react';
import { useAppContext } from "../../context/AppContext";
import QRCode from "react-qr-code"; //
import { ShieldCheck, CheckCircle, ArrowRight, Smartphone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Setup2FAScreen = () => {
  const { user, refreshSystemState } = useAppContext();
  const navigate = useNavigate();

  const [qrUri, setQrUri] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState(1); // 1 = Scan, 2 = Success
  const [error, setError] = useState('');

  // 1. Generate QR Code on Mount
  useEffect(() => {
    if (!user?.username) return;
    fetch('/setup-2fa/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username })
    })
    .then(res => res.json())
    .then(data => {
        setQrUri(data.qr_uri);
        setTempToken(data.temp_token);
    });
  }, [user]);

  // 2. Verify Code
  const handleVerify = async (e) => {
    e.preventDefault();
    const res = await fetch('/verify-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp_token: tempToken, code })
    });
    const data = await res.json();
    if (data.success) {
        setStep(2);
        // Wait 2 seconds then go to dashboard
        setTimeout(() => {
            navigate('/');
        }, 2000);
    } else {
        setError("Invalid code. Try again.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200">
        
        {step === 1 ? (
            <>
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Smartphone size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900">Secure Your Account</h1>
                    <p className="text-slate-500 mt-2 text-sm">
                        Scan this QR code with <strong>Google Authenticator</strong> or <strong>Microsoft Authenticator</strong>.
                    </p>
                </div>

                {/* QR Display */}
                <div className="flex justify-center mb-8 bg-white p-4 border-2 border-slate-100 rounded-xl">
                    {qrUri ? (
                        <QRCode 
                            value={qrUri} 
                            size={180} 
                            level="H" 
                        />
                    ) : (
                        <div className="w-[180px] h-[180px] bg-slate-100 animate-pulse rounded"/>
                    )}
                </div>

                <form onSubmit={handleVerify} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                            Enter the 6-digit code from the app
                        </label>
                        <input 
                            type="text" 
                            maxLength="6"
                            placeholder="000 000"
                            className="w-full text-center text-2xl font-mono tracking-[0.5em] py-3 border-2 border-slate-200 rounded-lg focus:border-blue-500 outline-none"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                        />
                    </div>
                    
                    {error && <div className="text-red-500 text-sm text-center font-medium">{error}</div>}

                    <button className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 transition-all">
                        Verify & Enable
                    </button>
                </form>
            </>
        ) : (
            <div className="text-center py-10">
                <CheckCircle size={64} className="text-emerald-500 mx-auto mb-4"/>
                <h2 className="text-2xl font-bold text-slate-900">Protection Enabled</h2>
                <p className="text-slate-500 mt-2">Your account is now secured with 2FA.</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default Setup2FAScreen;