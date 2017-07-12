import {CommonModule} from "@angular/common";
import {
    AfterViewInit, Component, ElementRef, forwardRef, Input, NgModule, OnInit, Renderer2, ViewChild
} from "@angular/core";
import {ControlValueAccessor, NG_VALUE_ACCESSOR} from "@angular/forms";
import {HammerGesturesManager} from "../core/touch";

export enum SliderType {
    SINGLE_HORIZONTAL,
    DOUBLE_HORIZONTAL,
    SINGLE_VERTICAL,
    DOUBLE_VERTICAL
}

enum SliderHandle {
    FROM,
    TO
}

export interface IDualSliderValue {
    lower: number;
    upper: number;
}

const noop = () => {
};

function MakeProvider(type: any) {
    return {
        multi: true,
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => type)
    };
}

@Component({
    moduleId: module.id,
    providers: [HammerGesturesManager, MakeProvider(IgxRange)],
    selector: "igx-range",
    templateUrl: "range.component.html"
})
export class IgxRange implements ControlValueAccessor, OnInit, AfterViewInit {
    /**
     *
     * @type {number}
     */
    @Input()
    public digitsAfterDecimalPoints: number = 0;

    /**
     * The type of the slider
     * @type {SliderType}
     */
    @Input()
    public type: SliderType = SliderType.SINGLE_HORIZONTAL;

    public isActiveLabel: boolean = false;

    @Input()
    public thumbLabelVisibilityDuration: number = 750;

    /**
     *
     * @type {number}
     */
    @Input()
    public stepRange: number = 1;

    private activeHandle: SliderHandle = SliderHandle.TO;

    @ViewChild("range")
    private slider: ElementRef;

    @ViewChild("track")
    private track: ElementRef;

    @ViewChild("ticks")
    private ticks: ElementRef;

    @ViewChild("thumbFrom")
    private thumbFrom: ElementRef;

    @ViewChild("thumbTo")
    private thumbTo: ElementRef;

    private _minValue: number = 0;

    // Measures & Coordinates
    private width: number = 0;
    private xOffset: number = 0;
    private xPointer: number = 0;
    private pPointer: number = 0;

    // Limit handle travel zone
    private pMin: number = 0;
    private pMax: number = 1;

    // From/upperValue in percent values
    private fromPercent: number = 0;
    private toPercent: number = 0;
    private hasViewInit: boolean = false;
    private timer;
    private _maxValue: number = 100;
    private _lowerBound?: number;
    private _upperBound?: number;
    private _lowerValue: number;
    private _upperValue: number;

    private _onChangeCallback: (_: any) => void = noop;
    private _onTouchedCallback: () => void = noop;

    constructor(private renderer: Renderer2) {
    }

    get isMulti(): boolean {
        const isMulti: boolean = this.type !== SliderType.SINGLE_HORIZONTAL &&
            this.type !== SliderType.SINGLE_VERTICAL;

        return isMulti;
    }

    public get minValue(): number {
        return this._minValue;
    }

    /**
     *
     * @type {number}
     */
    @Input()
    public set minValue(value: number) {
        if (value >= this.maxValue) {
            this._minValue = this.maxValue - 1;
            return;
        }

        this._minValue = value;
    }

    public get maxValue(): number {
        return this._maxValue;
    }

    /**
     *
     * @type {number}
     */
    @Input()
    public set maxValue(value: number) {
        if (value <= this._minValue) {
            this._maxValue = this._minValue + 1;

            return;
        }

        this._maxValue = value;
    }

    /**
     * Gets the lower bound of the range value
     * @returns {number}
     */
    public get lowerBound(): number {
        return this._lowerBound;
    }

    /**
     * Sets the lower bound of the range value
     * @type {number}
     */
    @Input()
    public set lowerBound(value: number) {
        if (value >= this.upperBound) {
            this._lowerBound = this.minValue;
            return;
        }

        this._lowerBound = value;
    }

    get upperBound(): number {
        return this._upperBound;
    }

    /**
     * The upper bound of the range value
     * @type {number}
     */
    @Input()
    set upperBound(value: number) {
        if (value <= this.lowerBound) {
            this._upperBound = this.maxValue;

            return;
        }

        this._upperBound = value;
    }

    private get lowerValue(): number {
        return this._lowerValue;
    }

    /**
     * Lower value of the range
     * @type {number}
     */
    private set lowerValue(value: number) {
        if (value < this.lowerBound || this.upperBound < value) {
            return;
        }

        if (this.isMulti && value > this.upperValue) {
            return;
        }

        this._lowerValue = value;
    }

    private get upperValue() {
        return this._upperValue;
    }

    /**
     * Upper value of the range
     * The default thumb value if the slider has singe thumb
     * @type {number}
     */
    private set upperValue(value: number) {
        if (value < this.lowerBound || this.upperBound < value) {
            return;
        }

        if (this.isMulti && value < this.lowerValue) {
            return;
        }

        this._upperValue = value;
    }

    public get value(): number | IDualSliderValue {
        if (this.isMulti) {
            return {
                lower: this.lowerValue,
                upper: this.upperValue
            };
        } else {
            return this.upperValue;
        }
    }

    @Input()
    public set value(value: number | IDualSliderValue) {
        if (!this.isMulti) {
            this.upperValue = <number>value;
        } else {
            this.upperValue = (<IDualSliderValue>value) == null ? null : (<IDualSliderValue>value).upper;
            this.lowerValue = (<IDualSliderValue>value) == null ? null : (<IDualSliderValue>value).lower;
        }

        this._onChangeCallback(value);

        if (this.hasViewInit) {
            this.positionHandlesAndUpdateTrack();
        }
    }

    public ngOnInit() {
        if (this.lowerBound === undefined) {
            this.lowerBound = this.minValue;
        }

        if (this.upperBound === undefined) {
            this.upperBound = this.maxValue;
        }

        if (this.isMulti) {
            this.value = {
                lower: this.lowerBound,
                upper: this.upperBound
            };
        } else {
            this.value = this.lowerBound;
        }

        this.pMin = this.valueToFraction(this.lowerBound) || 0;
        this.pMax = this.valueToFraction(this.upperBound) || 1;
    }

    public ngAfterViewInit() {
        this.hasViewInit = true;
        this.positionHandlesAndUpdateTrack();
        this.setTickInterval();
    }

    public update($event) {
        // Set width and offset first
        this.setSliderWidth();
        this.setSliderOffset();

        // Then get pointer coordinates
        this.setPointerPosition($event);
        this.setPointerPercent();

        // Find the closest handle if dual slider
        if (this.isMulti) {
            this.closestHandle();
        }
        this.toggleActiveClass($event);

        // Update To/From Values
        this.setValues();
        // this.printInfo();

        // Finally do positionHandlesAndUpdateTrack the DOM
        // based on data values
        this.positionHandlesAndUpdateTrack();
        this._onTouchedCallback();
    }

    public getPointerPosition(): number {
        return this.xPointer;
    }

    public getSliderOffset(): number {
        return this.xOffset;
    }

    public getPointerPercent(): number {
        return this.pPointer;
    }

    public toFixed(num: number): number {
        num = parseFloat(num.toFixed(20));
        return num;
    }

    public positionHandle(handle: ElementRef, position: number) {
        handle.nativeElement.style.left = `${this.valueToFraction(position) * 100}%`;
    }

    public writeValue(value: any): void {
        this.value = value;
    }

    public registerOnChange(fn: any): void {
        this._onChangeCallback = fn;
    }

    public registerOnTouched(fn: any): void {
        this._onTouchedCallback = fn;
    }

    protected generateTickMarks(color: string, interval: number) {
        return `repeating-linear-gradient(
            ${"to left"},
            ${color},
            ${color} 1.5px,
            transparent 1.5px,
            transparent ${interval}%
        ), repeating-linear-gradient(
            ${"to right"},
            ${color},
            ${color} 1.5px,
            transparent 1.5px,
            transparent ${interval}%
        )`;
    }

    private positionHandlesAndUpdateTrack() {
        if (!this.isMulti) {
            this.positionHandle(this.thumbTo, <number>this.value);
        } else {
            this.positionHandle(this.thumbTo, (<IDualSliderValue>this.value).upper);
            this.positionHandle(this.thumbFrom, (<IDualSliderValue>this.value).lower);
        }

        this.updateTrack();
    }

    private closestHandle() {
        const fromOffset = this.thumbFrom.nativeElement.offsetLeft + this.thumbFrom.nativeElement.offsetWidth / 2;
        const toOffset = this.thumbTo.nativeElement.offsetLeft + this.thumbTo.nativeElement.offsetWidth / 2;
        const match = this.closestTo(this.xPointer, [fromOffset, toOffset]);

        if (match === toOffset) {
            this.activeHandle = SliderHandle.TO;
        } else if (match === fromOffset) {
            this.activeHandle = SliderHandle.FROM;
        }
    }

    private setTickInterval() {
        const interval = this.stepRange > 1 ? 100 / this.stepRange : null;
        // CONSIDER
        // Use the renderer to style all elements of the range component?
        this.renderer.setStyle(this.ticks.nativeElement, "background", this.generateTickMarks("white", interval));

        // OTHERWISE uncomment below
        // this.ticks.nativeElement.style.backround = this.generateTickMarks('white', interval);
    }

    private toggleActiveClass(e) {
        if (e.type === "panstart" || e.type === "tap") {
            clearInterval(this.timer);
            this.isActiveLabel = true;
        }

        if (e.type === "panend" || e.type === "tap") {
            this.timer = setTimeout(
                () => this.isActiveLabel = false,
                this.thumbLabelVisibilityDuration
            );
        }
    }

    private closestTo(goal: number, positions: number[]): number {
        return positions.reduce((previous, current) => {
            return (Math.abs(goal - current) < Math.abs(goal - previous) ? current : previous);
        });
    }

    // Set Values for To/From based on active handle
    private setValues() {
        if (this.activeHandle === SliderHandle.TO) {
            if (this.isMulti) {
                this.value = {
                    upper: this.fractionToValue(this.pPointer),
                    lower: (<IDualSliderValue>this.value).lower
                };
            } else {
                this.value = this.fractionToValue(this.pPointer);
            }
            this.toPercent = this.fractionToPercent(this.pPointer);
        }

        if (this.activeHandle === SliderHandle.FROM) {
            this.value = {
                upper: (<IDualSliderValue>this.value).upper,
                lower: this.fractionToValue(this.pPointer)
            };

            this.fromPercent = this.fractionToPercent(this.pPointer);
        }
    }

    private setSliderWidth(): void {
        this.width = this.slider.nativeElement.offsetWidth;
    }

    private setPointerPosition(e) {
        this.xPointer = e.center.x - this.getSliderOffset();
    }

    private setSliderOffset() {
        const rect = this.slider.nativeElement.getBoundingClientRect();
        this.xOffset = rect.left;
    }

    private setPointerPercent() {
        this.pPointer = this.limit(this.toFixed(this.xPointer / this.width));
    }

    private valueToFraction(value: number) {
        return this.limit((value - this.minValue) / (this.maxValue - this.minValue));
    }

    private fractionToValue(fraction: number): number {
        const max: number = this.maxValue;
        const min: number = this.minValue;

        return (max - min) * fraction + min;
    }

    private fractionToPercent(fraction: number): number {
        return this.toFixed(fraction * 100);
    }

    private limit(num: number): number {
        return Math.max(this.pMin, Math.min(num, this.pMax));
    }

    private formatValue(value: number) {
        if (value === null || value === undefined) {
            return;
        }

        return value.toFixed(this.digitsAfterDecimalPoints);
    }

    private updateTrack() {
        const fromPosition = this.valueToFraction(this.lowerValue);
        const toPosition = this.valueToFraction(this.upperValue);
        const positionGap = (this.valueToFraction(this.upperValue) - this.valueToFraction(this.lowerValue));

        if (!this.isMulti) {
            this.track.nativeElement.style.transform = `scaleX(${toPosition})`;
        }

        if (this.isMulti) {
            this.track.nativeElement.style.transform = `scaleX(${1})`;
            this.track.nativeElement.style.left = `${fromPosition * 100}%`;
            this.track.nativeElement.style.width = `${positionGap * 100}%`;
        }
    }

    private onKeyDown($event: KeyboardEvent) {
        let incrementSign;

        if ($event.key.endsWith("Left")) {
            incrementSign = -1;
        } else if ($event.key.endsWith("Right")) {
            incrementSign = 1;
        } else {
            return;
        }

        if (this.isMulti) {
            if (this.activeHandle == SliderHandle.FROM) {
                let newLower = (<IDualSliderValue>this.value).lower + incrementSign * this.stepRange;

                if (newLower >= (<IDualSliderValue>this.value).upper) {
                    this.thumbTo.nativeElement.focus();
                    return;
                }

                this.value = {
                    lower: newLower,
                    upper: (<IDualSliderValue>this.value).upper
                }
            } else {
                let newUpper = (<IDualSliderValue>this.value).upper + incrementSign * this.stepRange;

                if (newUpper <= (<IDualSliderValue>this.value).lower) {
                    this.thumbFrom.nativeElement.focus();
                    return;
                }

                this.value = {
                    lower: (<IDualSliderValue>this.value).lower,
                    upper: (<IDualSliderValue>this.value).upper + incrementSign * this.stepRange
                }
            }
        } else {
            this.value = <number>this.value + incrementSign * this.stepRange;
        }

        this.isActiveLabel = true;
    }

    private hideThumbLabels($event: KeyboardEvent) {
        this.isActiveLabel = false;
    }

    private onFocus($event: FocusEvent) {
        console.log("focused");
        if (this.isMulti && $event.target == this.thumbFrom.nativeElement) {
            this.activeHandle = SliderHandle.FROM;
        }

        if ($event.target == this.thumbTo.nativeElement) {
            this.activeHandle = SliderHandle.TO;
        }
    }
}

@NgModule({
    declarations: [IgxRange],
    exports: [IgxRange],
    imports: [CommonModule]
})
export class IgxRangeModule {
}
