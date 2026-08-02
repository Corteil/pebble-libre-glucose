module.exports = [
  {
    type: 'heading',
    defaultValue: 'Libre Glucose'
  },
  {
    type: 'text',
    defaultValue: '<img src="data:image/png;base64,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" ' +
      'style="display:block;margin:0 auto;width:144px;height:168px;' +
      'border-radius:4px;" alt="Watchface preview">'
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
        type: 'select',
        messageKey: 'THEME_LIGHT',
        label: 'Theme',
        defaultValue: '0',
        options: [
          { label: 'Dark', value: '0' },
          { label: 'Light', value: '1' }
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
