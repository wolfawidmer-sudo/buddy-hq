'use strict';

// Testdaten im Format der EZB-Referenzkurse. Die Kurse sind erfunden.
const ECB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-11-06'>
      <Cube currency='USD' rate='1.1500'/>
      <Cube currency='CHF' rate='0.9200'/>
    </Cube>
    <Cube time='2026-11-05'>
      <Cube currency='USD' rate='1.1600'/>
      <Cube currency='CHF' rate='0.9280'/>
    </Cube>
    <Cube time='2026-11-04'>
      <Cube currency='USD' rate='1.2500'/>
      <Cube currency='CHF' rate='1.0000'/>
    </Cube>
    <Cube time='2026-11-03'>
      <Cube currency='USD' rate='1.2500'/>
      <Cube currency='CHF' rate='1.0000'/>
    </Cube>
    <Cube time='2026-11-02'>
      <Cube currency='USD' rate='1.2500'/>
      <Cube currency='CHF' rate='1.0000'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

// 2026-11-09 12:00 Zürich (UTC+1)
const NOW = Date.UTC(2026, 10, 9, 11, 0, 0);

function ts(isoUtc) {
  return Math.floor(Date.parse(isoUtc) / 1000);
}

module.exports = { ECB_XML, NOW, ts };
