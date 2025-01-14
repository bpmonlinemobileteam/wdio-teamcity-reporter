const WdioReporter = require('@wdio/reporter').default;
const assert = require('assert');
const fs = require('fs')
const path = require('path')
const Readable = require('stream').Readable

/**
 * @typedef {Object} SuiteStats
 * @property {string} type
 * @property {string} start
 * @property {string} uid
 * @property {string} cid
 * @property {string} title
 * @property {string} fullTitle
 * @property {undefined} tags
 * @property {Array} tests
 * @property {Array} hooks
 * @property {Array} suites
 * @property {Array} hooksAndTests
 */

/**
 * @typedef {Object} TestStats
 * @property {string} type
 * @property {string} start
 * @property {number} _duration
 * @property {string} uid
 * @property {string} cid
 * @property {string} title
 * @property {string} fullTitle
 * @property {Array} output
 * @property {any} argument
 * @property {string} state
 * @property {string} [end]
 */

/**
 * @typedef {Object} HookStats
 * @property {string} type
 * @property {string} start
 * @property {number} _duration
 * @property {string} uid
 * @property {string} cid
 * @property {string} title
 * @property {string} fullTitle
 * @property {Array} output
 * @property {any} argument
 * @property {string} state
 * @property {string} [end]
 */

class WdioTeamcityReporter extends WdioReporter {
  static escape (str) {
    if (!str) return '';
    return str
      .toString()
      .replace(/\|/g, '||')
      .replace(/\n/g, '|n')
      .replace(/\r/g, '|r')
      .replace(/\[/g, '|[')
      .replace(/\]/g, '|]')
      .replace(/\u0085/g, '|x') // next line
      .replace(/\u2028/g, '|l') // line separator
      .replace(/\u2029/g, '|p') // paragraph separator
      .replace(/'/g, '|\'');
  }

  static bool (value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  static number (value, fallback) {
    return typeof value === 'number' ? value : fallback;
  }

  static string (value, fallback) {
    return typeof value === 'string' ? value : fallback;
  }

  constructor (reporterOptions) {
    const r = WdioTeamcityReporter;
    const params = {
      captureStandardOutput: r.bool(reporterOptions.captureStandardOutput, false),
      flowId: r.bool(reporterOptions.flowId, true),
      message: r.string(reporterOptions.message, '[title]'),
      screenshotPath: r.string(reporterOptions.screenshotPath, 'temp/screenshots/'),
      stdout: true,
      writeStream: process.stdout,
    };
    const options = Object.assign(reporterOptions, params);

    super(options);

    this.currentTestStats = null;
    this.screenshotDirFullPath = path.join(process.cwd(), params.screenshotPath);
    fs.mkdirSync(this.screenshotDirFullPath, { recursive: true });
  }

  /**
   * @param {SuiteStats} suiteStats
   */
  onSuiteStart (suiteStats) {
    this._m('##teamcity[testSuiteStarted name=\'{name}\' flowId=\'{id}\']', suiteStats);
  }

  /**
   * @param {TestStats} testStats
   */
  onTestStart (testStats) {
    this.currentTestStats = testStats;
    this._m('##teamcity[testStarted name=\'{name}\' captureStandardOutput=\'{capture}\' flowId=\'{id}\']', testStats);
  }

  /**
   * @param {TestStats} testStats
   */
  onTestEnd (testStats) {
    if (testStats.state === 'skipped') return;
    this._m('##teamcity[testFinished name=\'{name}\' duration=\'{ms}\' flowId=\'{id}\']', testStats);
  }

  onAfterCommand (command) {
    const screenshotRegEx = /\/session\/[^/]*\/screenshot/;
    if (!screenshotRegEx.test(command.endpoint) || !command.result.value) {
      return;
    }
    const currentDate = new Date();
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    const hours = String(currentDate.getHours()).padStart(2, '0');
    const minutes = String(currentDate.getMinutes()).padStart(2, '0');
    const seconds = String(currentDate.getSeconds()).padStart(2, '0');
    const milliseconds = String(currentDate.getMilliseconds()).padStart(3, '0');
    const fileName = `${day}-${month}-${year}_${hours}-${minutes}-${seconds}_${milliseconds}.png`;

    const bufferData = Buffer.from(command.result.value, 'base64');
    const streamData = new Readable();
    const filePath = path.join(this.screenshotDirFullPath, fileName);
    streamData.push(bufferData);
    streamData.push(null);
    streamData.pipe(fs.createWriteStream(filePath));
    const screenshotDisplayName = `Screenshot ${hours}:${minutes}:${seconds}.${milliseconds}`;
    this._m(`##teamcity[testMetadata name='${screenshotDisplayName}' type='image' value='${fileName}' flowId='{id}']`, this.currentTestStats);
  }

  /**
   * @param {TestStats} testStats
   */
  onTestFail (testStats) {
    const { escape, number } = WdioTeamcityReporter;
    const specFileRetryAttempts = number(this.runnerStat.config.specFileRetryAttempts, 0);
    const specFileRetries = number(this.runnerStat.config.specFileRetries, 0);
    const attempt = escape(`${specFileRetryAttempts}/${specFileRetries}`);

    if (specFileRetryAttempts === specFileRetries) {
      // ##teamcity[testFailed type='comparisonFailure' name='test2' message='failure message' details='message and stack trace' expected='expected value' actual='actual value']
      this._m('##teamcity[testFailed name=\'{name}\' message=\'{error}\' details=\'{stack}\' flowId=\'{id}\']', testStats);
    } else {
      this._m(`##teamcity[message name='{name}' text='attempt ${attempt} failed: {error}' flowId='{id}']`, testStats);
    }
  }

  /**
   * @param {HookStats} hookStats
   */
  onHookEnd (hookStats) {
    if (hookStats.state === 'failed') {
      this._m('##teamcity[testFailed name=\'{name}\' message=\'{error}\' details=\'{stack}\' flowId=\'{id}\']', hookStats);
    }
  }

  /**
   * @param {TestStats} testStats
   */
  onTestSkip (testStats) {
    this._m('##teamcity[testIgnored name=\'{name}\' message=\'skipped\' flowId=\'{id}\']', testStats);
  }

  /**
   * @param {SuiteStats} suiteStats
   */
  onSuiteEnd (suiteStats) {
    const pendingTests = Object.values(suiteStats.tests).filter(test => test.state === 'pending');
    pendingTests.forEach(testStat => {
      this._m('##teamcity[testIgnored name=\'{name}\' message=\'skipped\' flowId=\'{id}\']', testStat);
    });

    this._m('##teamcity[testSuiteFinished name=\'{name}\' flowId=\'{id}\']', suiteStats);
  }

  /**
   * @param {string} template
   * @param {TestStats | SuiteStats} stats
   */
  _m (template, stats) {
    assert(stats != null, '_m(): missing stats argument');

    if (!this.options.flowId) {
      template = template.replace(' flowId=\'{id}\'', '');
    }

    const fragment = pattern => {
      switch (pattern) {
      case '{capture}':
        return this.options.captureStandardOutput ? 'true' : 'false';
      case '{id}':
        return this.runnerStat.sessionId + '/' + stats.cid;
      case '{ms}':
        return stats._duration;
      case '{name}': {
        let name = this.options.message;
        if (name.includes('[browser]')) name = name.replace(/\[browser\]/g, this._v());
        if (name.includes('[title]')) name = name.replace(/\[title\]/g, stats.title);
        return name;
      } case '{state}':
        return stats.state;
      case '{error}':
        return stats.error.message;
      case '{stack}':
        return stats.error.stack;
      default:
        return '';
      }
    };

    const m = template.replace(/\{[a-z]+\}/gi, m =>
      WdioTeamcityReporter.escape(fragment(m)));

    this.write(m + '\n');
  }

  _v () {
    // @see https://github.com/webdriverio/webdriverio/blob/v6.10.5/packages/webdriver/src/types.ts#L215
    const { browserName, browserVersion, version } = this.runnerStat.capabilities;
    return `${browserName} ${browserVersion || version}`;
  }
}

module.exports.default = WdioTeamcityReporter;
module.exports.reporterName = 'teamcity';
