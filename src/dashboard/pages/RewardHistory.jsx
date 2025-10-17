import React from 'react';

import { Table, Space } from 'antd';

import { Container, Text, TableConfig, useStyle } from '../component';

import iiLogo from '../assets/images/ii_powered.png';

import { dataSource, columns } from './samples/history';

const RewardHistory = ({ rewardHistories }) => {
  const { styles } = useStyle();

  const Header = () => {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          marginBottom: '32px',
        }}
      >
        <Text
          children="Shows the history of the nodes you provide to your clients, managed transparently through the ICP canister."
          size={14}
        />
        <img
          src={iiLogo}
          width={188}
          height={27}
          alt="Internet Identity Logo"
        />
      </div>
    );
  };

  return (
    <>
      <Header />
      <Container>
        <TableConfig>
          <Table
            className={styles.customTable}
            dataSource={dataSource(rewardHistories)}
            columns={columns}
            pagination={false}
            bordered={false}
            showHeader={true}
            size="small"
            scroll={{
              x: 'max-content',
            }}
          />
        </TableConfig>
      </Container>
    </>
  );
};

export default RewardHistory;
