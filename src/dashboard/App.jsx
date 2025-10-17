import React from 'react';
import { BrowserRouter } from 'react-router-dom';

import AuthPage from './AuthPage';
import { useAuth, AuthProvider } from './use-auth-client';
import './assets/main.css';
import HomePage from './HomePage';

function App() {
  const { isAuthenticated, identity } = useAuth();

  if (isAuthenticated) {
    return <HomePage />;
  }

  return <AuthPage />; // <>{isAuthenticated ? <LoggedIn /> : <AuthPage />}</>;
}

export default () => (
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);
