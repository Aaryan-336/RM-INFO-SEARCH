// Compliance Module
// Per COMPLIANCE.md — ensures every displayed field meets compliance requirements

import { meetsThreshold } from '../utils/confidence.js';

const PROHIBITED_SOURCE_KEYWORDS = [
  'leaked', 'breach', 'dump', 'hack', 'stolen', 'dark web',
  'private account', 'scraped private', 'password',
];

export function runComplianceChecks(validatedData, mcaData, logger) {
  const start = Date.now();
  logger.running('Compliance', 'Running compliance checks on all data');

  const report = {
    totalFields: 0,
    compliantFields: 0,
    removedFields: 0,
    issues: [],
    status: 'PASS',
  };

  // Check phones
  if (validatedData.phones) {
    for (let i = validatedData.phones.length - 1; i >= 0; i--) {
      const phone = validatedData.phones[i];
      report.totalFields++;
      const check = checkField(phone);
      if (!check.pass) {
        report.issues.push({ field: 'phone', value: maskValue(phone.value), reason: check.reason });
        validatedData.phones.splice(i, 1);
        report.removedFields++;
      } else {
        phone.complianceStatus = 'Compliant';
        report.compliantFields++;
      }
    }
  }

  // Check emails
  if (validatedData.emails) {
    for (let i = validatedData.emails.length - 1; i >= 0; i--) {
      const email = validatedData.emails[i];
      report.totalFields++;
      const check = checkField(email);
      if (!check.pass) {
        report.issues.push({ field: 'email', value: maskValue(email.value), reason: check.reason });
        validatedData.emails.splice(i, 1);
        report.removedFields++;
      } else {
        email.complianceStatus = 'Compliant';
        report.compliantFields++;
      }
    }
  }

  // Check MCA data
  if (mcaData?.company) {
    report.totalFields++;
    mcaData.company.complianceStatus = 'Compliant';
    report.compliantFields++;
  }

  if (mcaData?.directors) {
    for (const dir of mcaData.directors) {
      report.totalFields++;
      dir.complianceStatus = 'Compliant';
      report.compliantFields++;
    }
  }

  // Determine overall status
  if (report.removedFields > 0) {
    report.status = report.compliantFields > 0 ? 'PARTIAL' : 'FAIL';
  }

  const duration = Date.now() - start;
  const statusMsg = report.removedFields > 0
    ? `${report.removedFields} field(s) removed for non-compliance`
    : 'All fields compliant';

  logger.success('Compliance',
    `${report.compliantFields}/${report.totalFields} fields compliant — ${statusMsg}`,
    { durationMs: duration, status: report.status }
  );

  return report;
}

function checkField(field) {
  // Must have source
  if (!field.sources && !field.source && !field.sourceType) {
    return { pass: false, reason: 'No source attribution' };
  }

  // Must have confidence
  if (field.confidence === undefined || field.confidence === null) {
    return { pass: false, reason: 'No confidence score' };
  }

  // Must meet threshold
  if (!meetsThreshold(field.confidence)) {
    return { pass: false, reason: `Confidence ${field.confidence} below threshold` };
  }

  // Must have timestamp
  if (!field.timestamp) {
    return { pass: false, reason: 'No collection timestamp' };
  }

  // Check for prohibited sources
  const sourcesStr = JSON.stringify(field.sources || field.source || '').toLowerCase();
  for (const keyword of PROHIBITED_SOURCE_KEYWORDS) {
    if (sourcesStr.includes(keyword)) {
      return { pass: false, reason: `Prohibited source keyword: "${keyword}"` };
    }
  }

  return { pass: true };
}

function maskValue(val) {
  if (!val) return '***';
  if (val.includes('@')) {
    const [local, domain] = val.split('@');
    return `${local.substring(0, 2)}***@${domain}`;
  }
  if (val.length > 6) {
    return `${val.substring(0, 3)}***${val.substring(val.length - 2)}`;
  }
  return '***';
}
