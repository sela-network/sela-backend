import React from 'react';

import selaLogo from '../assets/images/sela_logo.png';

const SelaLogo = () => {
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <img src={selaLogo} width={195} height={21} alt="Selanetwork Logo" />
      </div>
    </>
  );
};

export default SelaLogo;
