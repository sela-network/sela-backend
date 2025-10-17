import Color from '../../style/Color';

const dataset = (data) => {
  const result = {};

  data.forEach((item) => {
    // Convert nanoseconds to milliseconds and create Date objects
    const startDate = new Date(Number(item.assignedAt / 1000000n));
    const endDate = new Date(Number(item.completeAt / 1000000n));
    const day = String(startDate.getDate()).padStart(2, '0');
    const month = String(startDate.getMonth() + 1).padStart(2, '0');
    const title = `${day}-${month}`; // "DD-MM"

    // Initialize the date key if it doesn't exist
    if (!result[title]) {
      result[title] = {
        title,
        date: startDate,
        startDate,
        endDate,
        node: 0,
        bonus: 0,
        referral: 0,
      };
    }

    // Accumulate the values (defaulting to 0 if a property is missing)
    result[title].node += item.reward || 0;
    result[title].bonus += item.bonus || 0;
    result[title].referral += item.referral || 0;
  });

  // Convert the result into the desired format
  return Object.values(result);
};

const series = [
  {
    dataKey: 'bonus',
    label: 'Bonus',
    stack: 'points',
    color: Color.darkOrange,
  },
  {
    dataKey: 'referral',
    label: 'Referral',
    stack: 'points',
    color: Color.orange,
  },
  {
    dataKey: 'node',
    label: 'Node',
    stack: 'points',
    color: Color.yellow,
  },
];

export { dataset, series };
