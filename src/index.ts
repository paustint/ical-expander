'use strict';

import * as ICAL from 'ical.js';

// Copied from https://dxr.mozilla.org/comm-central/source/calendar/timezones/zones.json
// And compiled using node compile-zones.js
// See also https://github.com/mozilla-comm/ical.js/issues/195

export interface IcalExpanderOptions {
  ics: string;
  maxIterations?: number;
  skipInvalidDates?: boolean;
  convertOutput?: boolean;
}

export interface IcalExpanderTimes {
  startTime: number;
  endTime: number;
}

export interface IcalExpanderReturn {
  events: any[];
  occurrences: any[];
}

export type PropertyType = 'period' | 'text' | 'date' | 'integer' | 'double' | 'date-time' | 'date' | 'boolean';

export interface RegisterPropertyProps {
  // iCalendar: X-MY-PROPERTY:foo
  // jCal: ["x-my-property", {}, "text", "foo"]
  defaultType: PropertyType; // [required] The default type from ICAL.design.value
  allowedTypes?: PropertyType[]; // [optional] Valid value types this property can have (currently unused)
  detectType?: (value: any) => PropertyType; // [optional] A function called to determine which type the value is

  // iCalendar: X-MY-MULTIVAL:foo,bar,baz
  // jCal: ["x-my-multival", {}, "text", "foo", "bar", "baz"]
  multiValue?: string; // [optional] This property takes multiple, comma-separated values and turns them into a single jCal value.

  // iCalendar: X-MY-STRUCTUREDVAL:foo;bar;baz
  // jCal: ["x-my-structuredval", {}, "text", [ "foo", "bar", "baz" ] ]
  structuredValue?: string; // [optional] This property takes multiple, semicolon-separated values and turns them into a single jCal value.
}

let areTimezoneRegistered: boolean = false;
let registeredTimezones: any[];

export class IcalExpander {
  public maxIterations: number;
  public skipInvalidDates: boolean;
  public convertOutput: boolean;

  public jCalData: any;
  public component: any;
  public events: any[];
  public timezones: any[];
  public data: IcalExpanderReturn = {
    events: [],
    occurrences: [],
  };

  constructor(opts: IcalExpanderOptions) {
    this.maxIterations = opts.maxIterations != null && opts.maxIterations != undefined ? opts.maxIterations : 1000;
    this.skipInvalidDates = opts.skipInvalidDates != null && opts.skipInvalidDates != undefined ? opts.skipInvalidDates : false;
    this.convertOutput = opts.convertOutput ? true : false;

    this.jCalData = ICAL.parse(opts.ics);
    this.component = new ICAL.Component(this.jCalData);
    this.events = this.component.getAllSubcomponents('vevent').map(vevent => new ICAL.Event(vevent));

    if (this.skipInvalidDates) {
      this.events = this.events.filter(evt => {
        try {
          evt.startDate.toJSDate();
          evt.endDate.toJSDate();
          return true;
        } catch (err) {
          // skipping events with invalid time
          return false;
        }
      });
    }

    if (!areTimezoneRegistered) {
      this.timezones = [];
      this.registerTimezonesFromICS(this.component);
    } else {
      this.timezones = registeredTimezones;
    }
  }

  private registerTimezonesFromICS(component: any) {
    this.component.getAllSubcomponents('vtimezone').forEach(timezoneComp => {
      try {
        this.timezones.push(
          new ICAL.Timezone({
            component: timezoneComp,
            tzid: timezoneComp.getFirstPropertyValue('tzid'),
          }),
        );
      } catch (ex) {
        // error logging timezone
      }
    });
  }

  private isEventWithinRange(startTime: number, endTime: number, after?: Date, before?: Date): boolean {
    return (!after || endTime >= after.getTime()) && (!before || startTime <= before.getTime());
  }

  private getTimes(eventOrOccurrence): IcalExpanderTimes {
    const startTime = eventOrOccurrence.startDate.toJSDate().getTime();
    let endTime = eventOrOccurrence.endDate.toJSDate().getTime();

    // If it is an all day event, the end date is set to 00:00 of the next day
    // So we need to make it be 23:59:59 to compare correctly with the given range
    if (eventOrOccurrence.endDate.isDate && endTime > startTime) {
      endTime -= 1;
    }

    return { startTime, endTime };
  }

  /**
   *
   * Get any events that have any part of their event within the range of after and before
   * Set after undefined or null to get all events up to before
   * Set before undefined or null to get all events that start after the after Date
   *
   * @param after
   * @param before
   */
  public between(after?: Date, before?: Date): IcalExpanderReturn {
    const exceptions: any[] = [];

    this.events.forEach(event => {
      if (event.isRecurrenceException()) exceptions.push(event);
    });

    this.data = {
      events: [],
      occurrences: [],
    };

    this.events
      .filter(e => !e.isRecurrenceException())
      .forEach(event => {
        const exdates: any[] = [];

        event.component.getAllProperties('exdate').forEach(exdateProp => {
          const exdate = exdateProp.getFirstValue();
          exdates.push(exdate.toJSDate().getTime());
        });

        // Recurring event is handled differently
        if (event.isRecurring()) {
          const iterator = event.iterator();

          let next;
          let i = 0;

          do {
            i += 1;
            next = iterator.next();
            if (next) {
              const occurrence = event.getOccurrenceDetails(next);

              const { startTime, endTime } = this.getTimes(occurrence);

              const isOccurrenceExcluded = exdates.indexOf(startTime) !== -1;

              // TODO check that within same day?
              const exception = exceptions.find(
                (ex: any) => ex.uid === event.uid && ex.recurrenceId.toJSDate().getTime() === occurrence.startDate.toJSDate().getTime(),
              );

              // We have passed the max date, stop
              if (before && startTime > before.getTime()) break;

              // Check that we are within our range
              if (this.isEventWithinRange(startTime, endTime, after, before)) {
                if (exception) {
                  this.data.events.push(exception);
                } else if (!isOccurrenceExcluded) {
                  this.data.occurrences.push(occurrence);
                }
              }
            }
          } while (next && (!this.maxIterations || i < this.maxIterations));

          return;
        }

        // Non-recurring event:
        const { startTime, endTime } = this.getTimes(event);

        if (this.isEventWithinRange(startTime, endTime, after, before)) this.data.events.push(event);
      });

    if (this.convertOutput) {
      return this.getEventsAsObject();
    } else {
      return this.data;
    }
  }

  /**
   * Get all events that start before the provided Date
   * @param before
   */
  public before(before: Date): IcalExpanderReturn {
    return this.between(undefined, before);
  }

  /**
   * Get all events that end after the provided date
   * @param after
   */
  public after(after: Date): IcalExpanderReturn {
    return this.between(after);
  }

  /**
   * Get all events
   */
  public all(): IcalExpanderReturn {
    return this.between();
  }

  private getEventsAsObject() {
    const data: IcalExpanderReturn = {
      events: [],
      occurrences: [],
    };
    data.events = this.data.events.map(this.convertEvent);
    data.occurrences = this.data.occurrences.map(occurrence => ({
      endDate: occurrence.endDate,
      item: this.convertEvent(occurrence.item),
      recurrenceId: occurrence.recurrenceId,
      startDate: occurrence.startDate,
    }));
    return data;
  }

  private convertEvent(event: any) {
    return event.component.getAllProperties().reduce((acc, prop) => {
      // TODO: handle date and datetime to make like msft format - maybe allow function to be passed in for format
      if (prop.isMultiValue) {
        acc[prop.name] = prop.getValues();
      } else {
        acc[prop.name] = prop.getFirstValue();
      }
      return acc;
    }, {});
  }
}

/**
 * Register timezones from included JSON file
 * If timezones are included in the ICS, then they will be registered automatically on parse
 * in which case this method should not be called, as it required a performance hit when called.
 */
export function registerTimezones(): Promise<void> {
  return new Promise((resolve, reject) => {
    import('./zones-compiled.json')
      .then(timezones => {
        registeredTimezones = [];
        Object.keys(timezones).forEach(key => {
          try {
            // TS adds "default" property, which was not in original data - ignore it
            if (key === 'default') return;
            const icsData = timezones[key];
            const parsed = ICAL.parse(
              `BEGIN:VCALENDAR\nPRODID:-//tzurl.org//NONSGML Olson 2012h//EN\nVERSION:2.0\n${icsData}\nEND:VCALENDAR`,
            );
            const comp = new ICAL.Component(parsed);
            const vtimezone = comp.getFirstSubcomponent('vtimezone');
            registeredTimezones.push(vtimezone);
            ICAL.TimezoneService.register(vtimezone);
          } catch (ex) {
            // Error loading timezone
          }
        });
        areTimezoneRegistered = true;
        resolve();
      })
      .catch(err => {
        reject(err);
      });
  });
}

export function resetTimezones() {
  areTimezoneRegistered = false;
  registeredTimezones = [];
}

export function registerProperties(props: { [prop: string]: RegisterPropertyProps }) {
  Object.keys(props).forEach(key => (ICAL.design.icalendar.property[key.toLowerCase()] = props[key]));
}
