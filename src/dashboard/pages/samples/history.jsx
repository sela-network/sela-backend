import React from 'react';
import Color from '../../style/Color';
import { Text } from '../../component';
import { dataset } from './data';

// Function to format a single Date object to 'DD, MM, YY' or 'DD. MM. YY'
const formatDate = (date, delimiter = '/') => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2); // Get the last two digits of the year
  return `${day}${delimiter}${month}${delimiter}${year}`;
};

// Function to format two dates in the desired format
const formatDateRange = (startDate, endDate) => {
  const start = formatDate(startDate, '/'); // 'DD, MM, YY'
  const end = formatDate(endDate, '/'); // 'DD. MM. YY'
  return `${start} ~ ${end}`;
};

const dataSource = (rewardHistories) => {
  const data = dataset(rewardHistories);

  const result = [];

  var initialKey = 1;
  data.forEach((item) => {
    result.push({
      key: initialKey,
      epoch: 'Epoch 1',
      date: formatDateRange(item.startDate, item.endDate),
      uptime: '00 Days, 24 Hrs, 60 Min',
      nodeRewards: `${item.node} SP`,
      referralRewards: `${item.referral} SP`,
      bonusReward: `${item.bonus} SP`,
    });

    initialKey += 1;
  });
  return result;
};

const renderColumn = ({ text, color = '#fff' }) => {
  return {
    props: {
      style: { background: Color.black13 },
    },
    children: (
      <div>
        <Text children={text} color={color} size={14} />
      </div>
    ),
  };
};

const columns = [
  {
    title: 'Epoch',
    dataIndex: 'epoch',
    key: 'epoch',
    fixed: 'left',
    render(text) {
      return renderColumn({ text });
    },
  },
  {
    title: 'Start / End Date',
    dataIndex: 'date',
    key: 'date',
    render(text) {
      return renderColumn({ text });
    },
  },
  {
    title: 'Uptime',
    dataIndex: 'uptime',
    key: 'uptime',
    render(text) {
      return renderColumn({ text });
    },
  },
  {
    title: 'Node Rewards',
    dataIndex: 'nodeRewards',
    key: 'nodeRewards',
    render(text) {
      return renderColumn({ text });
    },
  },
  {
    title: 'Referral Rewards',
    dataIndex: 'referralRewards',
    key: 'referralRewards',
    render(text) {
      return renderColumn({ text });
    },
  },
  {
    title: 'Bonus Rewards',
    dataIndex: 'bonusReward',
    key: 'bonusReward',
    render(text) {
      return renderColumn({ text });
    },
  },
];

export { dataSource, columns };
