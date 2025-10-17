import React from 'react';

const Row = ({
  children,
  justifyContent = 'flex-start',
  alignItems = 'center',
  spacing = 16,
  flexWrap = 'wrap',
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: flexWrap,
        justifyContent: justifyContent,
        alignItems: alignItems,
        gap: spacing,
      }}
    >
      {children}
    </div>
  );
};

export default Row;
