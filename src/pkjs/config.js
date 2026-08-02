module.exports = [
  {
    type: 'heading',
    defaultValue: 'Libre Glucose'
  },
  {
    type: 'text',
    defaultValue: 'Shows your FreeStyle Libre reading using a LibreLinkUp ' +
      'follower account. In the patient\'s LibreLink app choose ' +
      'Share → LibreLinkUp and invite this account, then accept the ' +
      'invitation in the LibreLinkUp app.'
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'LibreLinkUp account'
      },
      {
        type: 'input',
        messageKey: 'EMAIL',
        label: 'Email',
        defaultValue: '',
        attributes: {
          type: 'email',
          placeholder: 'you@example.com'
        }
      },
      {
        type: 'input',
        messageKey: 'PASSWORD',
        label: 'Password',
        defaultValue: '',
        attributes: {
          type: 'password'
        }
      },
      {
        type: 'select',
        messageKey: 'REGION',
        label: 'Region',
        defaultValue: '',
        options: [
          { label: 'Auto detect', value: '' },
          { label: 'Europe', value: 'eu' },
          { label: 'Europe 2', value: 'eu2' },
          { label: 'United States', value: 'us' },
          { label: 'Germany', value: 'de' },
          { label: 'France', value: 'fr' },
          { label: 'Japan', value: 'jp' },
          { label: 'Asia/Pacific', value: 'ap' },
          { label: 'Australia', value: 'au' },
          { label: 'Middle East', value: 'ae' },
          { label: 'Canada', value: 'ca' },
          { label: 'Latin America', value: 'la' }
        ]
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Display'
      },
      {
        type: 'select',
        messageKey: 'UNITS_MMOL',
        label: 'Units',
        defaultValue: '1',
        options: [
          { label: 'mmol/L', value: '1' },
          { label: 'mg/dL', value: '0' }
        ]
      },
      {
        type: 'input',
        messageKey: 'LOW_MGDL',
        label: 'Low threshold (in your units)',
        defaultValue: '4.0',
        attributes: {
          type: 'text'
        }
      },
      {
        type: 'input',
        messageKey: 'HIGH_MGDL',
        label: 'High threshold (in your units)',
        defaultValue: '10.0',
        attributes: {
          type: 'text'
        }
      },
      {
        type: 'select',
        messageKey: 'REFRESH',
        label: 'Refresh interval',
        defaultValue: '5',
        options: [
          { label: 'Every minute', value: '1' },
          { label: 'Every 2 minutes', value: '2' },
          { label: 'Every 5 minutes', value: '5' },
          { label: 'Every 10 minutes', value: '10' }
        ]
      }
    ]
  },
  {
    type: 'section',
    items: [
      {
        type: 'heading',
        defaultValue: 'Alerts'
      },
      {
        type: 'toggle',
        messageKey: 'ALERT_LOW',
        label: 'Vibrate when going low',
        defaultValue: true
      },
      {
        type: 'toggle',
        messageKey: 'ALERT_HIGH',
        label: 'Vibrate when going high',
        defaultValue: false
      }
    ]
  },
  {
    type: 'submit',
    defaultValue: 'Save'
  }
];
