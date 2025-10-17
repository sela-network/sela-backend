import React from 'react';

import { ConfigProvider } from 'antd';
import { createStyles } from 'antd-style';

import Color from '../style/Color';

const TableConfig = ({ children }) => {
  return (
    <ConfigProvider
      theme={{
        components: {
          Table: {
            headerBg: Color.black13,
            headerBorderRadius: 0,
            headerColor: Color.yellow,
            headerSplitColor: Color.black13,
          },
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
};

const useStyle = createStyles(({ css, token }) => {
  const { antCls } = token;
  return {
    customTable: css`
      ${antCls}-table {
        ${antCls}-table-container {
          ${antCls}-table-body,
          ${antCls}-table-content {
            scrollbar-width: thin;
            scrollbar-color: #eaeaea transparent;
            scrollbar-gutter: stable;
          }
        }
      }
    `,
  };
});

export { useStyle, TableConfig };
