import React from 'react';

import Color from '../style/Color';

const Container = ({
  background = Color.black13,
  children,
  alignItems = 'normal',
  style,
  spacing = 16,
  flex = 1,
}) => {
  return (
    <div
      style={{
        background: background,
        padding: 24,
        borderRadius: 30,
        display: 'flex',
        flexDirection: 'column',
        alignItems: alignItems,
        gap: spacing,
        flex: flex,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export default Container;
