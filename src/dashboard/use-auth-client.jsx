import { AuthClient } from '@dfinity/auth-client';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { canisterId, createActor } from '../declarations/nodeCanister';
import {
  Ed25519PublicKey,
  ECDSAKeyIdentity,
  DelegationChain,
  DelegationIdentity,
} from '@dfinity/identity';
import { fromHexString } from '@dfinity/candid';
import { useSearchParams } from 'react-router-dom';

const AuthContext = createContext();

export const getIdentityProvider = () => {
  let idpProvider;
  // Safeguard against server rendering
  if (typeof window !== 'undefined') {
    idpProvider = process.env.IDP_PROVIDER
  }
  return idpProvider;
};

export const defaultOptions = {
  /**
   *  @type {import("@dfinity/auth-client").AuthClientCreateOptions}
   */
  createOptions: {
    idleOptions: {
      // Set to true if you do not want idle functionality
      disableIdle: true,
    },
  },
  /**
   * @type {import("@dfinity/auth-client").AuthClientLoginOptions}
   */
  loginOptions: {
    identityProvider: getIdentityProvider(),
  },
};

/**
 *
 * @param options - Options for the AuthClient
 * @param {AuthClientCreateOptions} options.createOptions - Options for the AuthClient.create() method
 * @param {AuthClientLoginOptions} options.loginOptions - Options for the AuthClient.login() method
 * @returns
 */
export const useAuthClient = (options = defaultOptions) => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authClient, setAuthClient] = useState(null);
  const [identity, setIdentity] = useState(null);
  const [principal, setPrincipal] = useState(null);
  const [nodeActor, setNodeActor] = useState(null);

  // For Client Redirection
  const [searchParams, setSearchParams] = useSearchParams();
  const [middleKeyIdentity, setMiddleKeyIdentity] = useState(null);

  useEffect(() => {
    const initializeAuthClient = async () => {
      // Create the Auth instance with options
      var newMiddleKey = middleKeyIdentity;
      if (!middleKeyIdentity) {
        newMiddleKey = await ECDSAKeyIdentity.generate();
      }

      let client;

      if (searchParams.get('sessionkey')) {
        client = await AuthClient.create({ identity: newMiddleKey });
      } else {
        client = await AuthClient.create(options.createOptions);
      }

      // Update the client in your state or context
      updateClient(client, newMiddleKey);
    };

    // Call the async function
    initializeAuthClient();
  }, []);

  const login = () => {
    authClient.login({
      ...options.loginOptions,
      onSuccess: () => {
        updateClient(authClient, middleKeyIdentity);
      },
    });
  };

  async function updateClient(client, middleKeyIdentity) {
    setMiddleKeyIdentity(middleKeyIdentity);

    setAuthClient(client);

    const isAuthenticated = await client.isAuthenticated();

    const identity = client.getIdentity();

    const principal = identity.getPrincipal();

    const actor = createActor(
      canisterId ? canisterId : process.env.CANISTER_ID_BACKEND,
      {
        agentOptions: {
          identity,
        },
      }
    );

    const sessionKey = searchParams.get('sessionkey');
    if (sessionKey) {
      const derPublicKey = fromHexString(sessionKey);
      const appPublicKey = Ed25519PublicKey.fromDer(derPublicKey);

      if (appPublicKey && identity instanceof DelegationIdentity) {
        let delegationChain = await DelegationChain.create(
          middleKeyIdentity,
          appPublicKey,
          new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          { previous: identity.getDelegation() }
        );

        var delegationString = JSON.stringify(delegationChain.toJSON());
        var result = encodeURIComponent(delegationString);

        const redirectScheme = searchParams.get('scheme');
        const redirectHost = searchParams.get('host');

        searchParams.delete('scheme');
        searchParams.delete('host');
        searchParams.delete('sessionkey');
        setSearchParams(searchParams);

        window.location.href = `${redirectHost}://${redirectScheme}?del=${result}&status=true`;

        logout();
      }
    } else {
      setIsAuthenticated(isAuthenticated);

      setIdentity(identity);
      setPrincipal(principal);

      setAuthClient(client);
      setNodeActor(actor);
    }
  }

  async function logout() {
    await authClient?.logout();
    await updateClient(authClient);
  }

  return {
    isAuthenticated,
    login,
    logout,
    authClient,
    identity,
    principal,
    nodeActor,
  };
};

/**
 * @type {React.FC}
 */
export const AuthProvider = ({ children }) => {
  const auth = useAuthClient();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
