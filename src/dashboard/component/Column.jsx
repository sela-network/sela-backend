import React from 'react';

const Column = ({ children, spacing = 16, flex = 1 }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: spacing,
        flex: flex,
      }}
    >
      {children}
    </div>
  );
};

export default Column;
