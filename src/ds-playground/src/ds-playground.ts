import { LitElement, PropertyValueMap, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { join } from 'lit/directives/join.js';
import '@material/web/chips/chip-set';
import '@material/web/chips/suggestion-chip';
import '@material/web/chips/filter-chip';

enum DeviceType {
  Internal = 'Internal',
  ThreePointFive = '3.5mm',
  USB = 'USB',
  HDMI = 'HDMI',
  Bluetooth = 'Bluetooth',
}

type Device = {
  ty: DeviceType;
  name: string;
};

function defaultDevices() {
  const spec: [DeviceType, number][] = [
    [DeviceType.Internal, 1],
    [DeviceType.ThreePointFive, 1],
    [DeviceType.USB, 3],
    [DeviceType.HDMI, 3],
    [DeviceType.Bluetooth, 3],
  ];
  const devices: Device[] = [];
  for (const [ty, count] of spec) {
    if (count === 1) {
      devices.push({ ty: ty, name: ty });
    } else {
      for (let i = 1; i <= count; i++) {
        devices.push({ ty: ty, name: `${ty} ${i}` });
      }
    }
  }
  return devices;
}

abstract class Strategy {
  abstract probe(devices: Device[]): Device | null;
  abstract select(device: Device): void;
  abstract clone(): Strategy;
  visualize(): unknown {
    return 'N/A';
  }
}

function contains(devices: Device[], device: Device) {
  return devices.some(x => device.name == x.name);
}

class PriorityListStrategy extends Strategy {
  connectedDevices: Device[] = [];
  priorityList: Device[] = [];
  active: Device | null = null;

  override clone(): PriorityListStrategy {
    const s = new PriorityListStrategy();
    s.connectedDevices = [...this.connectedDevices];
    s.priorityList = [...this.priorityList];
    s.active = this.active;
    return s;
  }

  override probe(newDevices: Device[]): Device | null {
    this.connectedDevices = this.connectedDevices.filter(x =>
      contains(newDevices, x)
    );
    const plugged = newDevices.filter(x => !contains(this.connectedDevices, x));

    // The active device is unplugged.
    if (this.active && !contains(this.connectedDevices, this.active)) {
      this.active = null;
    }

    if (this.active === null) {
      // Start with the remaining device with the highest user priority.
      this.select(
        this.connectedDevices.reduce(
          (accumulator: Device | null, currentValue: Device) => {
            const currentPriority = this.priorityList.findIndex(
              x => x.name == currentValue.name
            );
            if (currentPriority === -1) {
              return accumulator;
            }
            if (accumulator === null) {
              return currentValue;
            }
            const accumulatorPriority = this.priorityList.findIndex(
              x => x.name === accumulator.name
            );
            if (accumulatorPriority < currentPriority) {
              return currentValue;
            }
            return accumulator;
          },
          null
        )
      );
    }

    plugged.sort(
      (a, b) =>
        (a.ty === DeviceType.ThreePointFive ? 1 : 0) -
        (b.ty === DeviceType.ThreePointFive ? 1 : 0)
    );

    for (const hotplug of plugged) {
      this.connectedDevices.push(hotplug);
      if (this.shouldSwitchToHotPlugDevice(this.active, hotplug)) {
        this.select(hotplug);
      }
    }

    if (this.active === null) {
      // If there's still nothing selected at this point, just select one
      // based on the built-in priority.
      this.select(
        newDevices.reduce(
          (accumulator: Device | null, currentValue: Device) => {
            if (accumulator === null) {
              return currentValue;
            }
            if (
              this.getBuiltinPriority(accumulator) <
              this.getBuiltinPriority(currentValue)
            ) {
              return currentValue;
            }
            return accumulator;
          },
          null
        )
      );
    }

    return this.active;
  }

  override select(device: Device | null): void {
    if (device === null) {
      this.active = null;
      return;
    }
    if (!contains(this.connectedDevices, device)) {
      throw new Error(
        `${
          device.name
        } is not connected. Connected: ${this.connectedDevices.map(
          x => x.name
        )}`
      );
    }
    this.active = device;
    this.bubbleUp(device);
  }

  override visualize() {
    return html`User Priority:
    ${this.priorityList.length > 0
      ? join(
          this.priorityList.map(d => html`${d.name}`),
          ' < '
        )
      : '(empty)'}`;
  }

  bubbleUp(device: Device) {
    if (!contains(this.priorityList, device)) {
      this.priorityList.unshift(device);
    }
    const connectedDeviceNames = new Set(
      this.connectedDevices.map(x => x.name)
    );
    const fromIndex = this.priorityList.findIndex(x => x.name === device.name);
    let toIndex = 0;
    for (const [i, device] of this.priorityList.entries()) {
      if (connectedDeviceNames.has(device.name)) {
        toIndex = i;
      }
    }
    this.priorityList.splice(fromIndex, 1);
    this.priorityList.splice(toIndex, 0, device);
  }

  shouldSwitchToHotPlugDevice(
    current: Device | null,
    hotplug: Device
  ): boolean {
    if (current === null) {
      return true;
    }
    if (hotplug.ty === DeviceType.ThreePointFive) {
      return true;
    }

    const currentUserPriority = this.getUserPriority(current);
    const hotplugUserPriority = this.getUserPriority(hotplug);
    if (currentUserPriority !== null && hotplugUserPriority !== null) {
      return currentUserPriority <= hotplugUserPriority;
    }
    return this.getBuiltinPriority(current) <= this.getBuiltinPriority(hotplug);
  }

  getUserPriority(device: Device): number | null {
    const index = this.priorityList.findIndex(x => x.name == device.name);
    if (index === -1) {
      return null;
    }
    return index;
  }

  // See https://source.chromium.org/chromium/chromium/src/+/main:chromeos/ash/components/audio/audio_device.cc;l=22;drc=327564a4861822c816d35395dfb54d7e5039e6ea.
  getBuiltinPriority(device: Device): number {
    switch (device.ty) {
      case DeviceType.ThreePointFive:
      case DeviceType.USB:
      case DeviceType.Bluetooth:
        return 3;
      case DeviceType.Internal:
        return 2;
      case DeviceType.HDMI:
        return 1;
    }
  }
}

class State {
  name: string;
  connectedDevices: Device[] = [];
  active: Device | null = null;
  strategy: Strategy;
  constructor(name: string, strategy: Strategy) {
    this.name = name;
    this.strategy = strategy;
  }

  private clone(name: string) {
    const s = new State(name, this.strategy.clone());
    s.connectedDevices = [...this.connectedDevices];
    s.active = this.active;
    return s;
  }

  select(device: Device): State {
    const s = this.clone(`Select ${device.name}`);
    s.strategy.select(device);
    s.active = device;
    return s;
  }

  plug(device: Device): State {
    const s = this.clone(`Plug ${device.name}`);
    s.connectedDevices.push(device);
    s.active = s.strategy.probe(s.connectedDevices);
    return s;
  }

  unplug(device: Device): State {
    const s = this.clone(`Unplug ${device.name}`);
    s.connectedDevices = s.connectedDevices.filter(x => x.name !== device.name);
    s.active = s.strategy.probe(s.connectedDevices);
    return s;
  }
}

@customElement('ds-legend')
export class DsLegend extends LitElement {
  protected override render() {
    return html` <section>
      <h3>Help</h3>
      <ul>
        <li>
          <p>
            <md-chip-set
              ><md-filter-chip
                label="Device"
                selected
                elevated
                removable
                @click=${(e: Event) => e.preventDefault()}
                @remove=${(e: Event) => e.preventDefault()}
              ></md-filter-chip>
              This is a connected, active device. Click on "X" to
              unplug.</md-chip-set
            >
          </p>
        </li>
        <li>
          <p>
            <md-chip-set
              ><md-filter-chip
                label="Device"
                elevated
                removable
                @click=${(e: Event) => e.preventDefault()}
                @remove=${(e: Event) => e.preventDefault()}
              ></md-filter-chip>
              This is a connected device. Click on it to select. Click on "X" to
              unplug.</md-chip-set
            >
          </p>
        </li>
        <li>
          <p>
            <md-chip-set
              ><md-suggestion-chip label="Device"></md-suggestion-chip> This is
              a disconnected device. Click on it to plug.</md-chip-set
            >
          </p>
        </li>
      </ul>
    </section>`;
  }
}

@customElement('ds-state')
export class DsState extends LitElement {
  @state()
  state: State | null = null;
  pushFunc = (_s: State) => {};
  isLastState = false;

  protected override render() {
    return html`
      <section>
        <h4>${this.s.name}</h4>
        <p>
          <md-chip-set>
            ${defaultDevices().map(x => this.renderDevice(x))}
          </md-chip-set>
        </p>
        <p>${this.s.strategy.visualize()}</p>
      </section>
    `;
  }

  get s(): State {
    return this.state!;
  }

  renderDevice(device: Device) {
    if (contains(this.s.connectedDevices, device)) {
      return html`<md-filter-chip
        label=${device.name}
        elevated
        removable
        ?selected=${this.s.active?.name === device.name}
        @remove=${(e: Event) => {
          e.preventDefault();
          this.pushFunc(this.s.unplug(device));
        }}
        @click=${(e: Event) => {
          e.preventDefault();
          if (this.s.active?.name === device.name) {
            return;
          }
          this.pushFunc(this.s.select(device));
        }}
      ></md-filter-chip>`;
    }
    return html`<md-suggestion-chip
      label=${device.name}
      @click=${() => this.pushFunc(this.s.plug(device))}
    ></md-suggestion-chip>`;
  }

  protected override async updated() {
    if (!this.isLastState) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    document.body.scrollIntoView(false);
  }
}

/**
 * An example element.
 *
 * @fires count-changed - Indicates when the count changes
 * @slot - This element has a slot
 * @csspart button - The button
 */
@customElement('ds-playground')
export class DsPlayground extends LitElement {
  @state()
  steps: State[] = [new State('Initial state', new PriorityListStrategy())];

  override render() {
    return html`
      <ds-legend></ds-legend>
      <h3>Playground</h3>
      <section>
        <ol>
          ${[...this.steps.entries()].map(
            ([i, s]) =>
              html`<li>
                <ds-state
                  .state=${s}
                  .pushFunc=${(s: State) => this.push(i, s)}
                  .isLastState=${i + 1 === this.steps.length}
                ></ds-state>
              </li>`
          )}
        </ol>
      </section>
    `;
  }

  push(index: number, s: State) {
    this.steps.splice(index + 1, this.steps.length - index - 1, s);
    this.requestUpdate();
  }
}
