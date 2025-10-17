import React from 'react';
import { useAuth } from './use-auth-client';

import { Button } from 'antd';

import { SelaLogo, Text, Spacing } from './component';
import Color from './style/Color';

import globeLogo from './assets/images/globe.png';
import iidLogo from './assets/images/iid_logo.png';

function AuthPage() {
  const { login } = useAuth();

  const footerStyle = {
    fontSize: 14,
    color: '#fff',
    fontFamily: 'Urbanist',
    fontWeight: 'normal',
  };

  return (
    <div
      style={{
        minHeight: '90vh',
        padding: 12,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
      }}
    >
      <Text children={'Welcome to'} size={18} />
      <Spacing />
      <SelaLogo />
      <Spacing margin={64} />
      <img src={globeLogo} width={160} height={160} />
      <Spacing margin={64} />
      <Text children={'Sign Up'} size={14} />
      <Text children={'ICP Identity'} size={24} weight="light" />
      <Spacing margin={16} />
      <img src={iidLogo} width={64} height={30} />
      <Spacing margin={48} />
      <Button
        onClick={login}
        shape="round"
        size={16}
        style={{
          backgroundColor: Color.yellow,
          borderColor: Color.yellow,
          width: 361,
          height: 52,
        }}
      >
        <Text
          children={'Continue with Internet Identity'}
          size={14}
          weight="semiBold"
          color="#000"
        />
      </Button>
      ;
      <Spacing margin={16} />
      <div style={footerStyle}>
        {'Sela Network defaults to internetcomputer.org for authentication'}
      </div>
      <div style={footerStyle}>
        {'Alternatively, use the legacy method at ic0.app.'}
      </div>
      <Spacing margin={32} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: 32,
        }}
      >
        <Text
          children={'Privacy Policy'}
          size={14}
          decoration="underline"
          weight="semiBold"
        />
        <Text
          children={'Terms & Conditions'}
          size={14}
          decoration="underline"
          weight="semiBold"
        />
      </div>
    </div>
  );
}

export default AuthPage;
