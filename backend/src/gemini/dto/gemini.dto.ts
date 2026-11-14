import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const AUDIENCES = ['teacher', 'executive', 'general'] as const;

export class CheckSlideDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  slideTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15000)
  slideText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6_000_000)
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,/i, {
    message: 'รองรับเฉพาะไฟล์ภาพ PNG, JPEG หรือ WebP เท่านั้น',
  })
  slideImageBase64?: string;

  @IsString()
  @MaxLength(30000)
  transcript!: string;

  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];
}

export class InterruptQuestionDto extends CheckSlideDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  slideNumber?: number;
}

export class QaSlideItemDto {
  @IsInt()
  @Min(0)
  @Max(200)
  index!: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(15000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30000)
  transcript?: string;
}

export class QaGenerateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  deckName!: string;

  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  questionCount?: number;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => QaSlideItemDto)
  slides!: QaSlideItemDto[];
}

export class SummaryTimelineEventDto {
  @IsNumber()
  @Min(0)
  @Max(7200)
  t!: number;

  @IsString()
  @MaxLength(40)
  type!: string;

  @IsString()
  @MaxLength(200)
  label!: string;
}

export class QaEvaluateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(15000)
  slideContext?: string;

  @IsString()
  @MaxLength(15000)
  answerTranscript!: string;

  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SummaryTimelineEventDto)
  timelineEvents?: SummaryTimelineEventDto[];
}

export class SummarySlideItemDto extends QaSlideItemDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  wpm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  fillersCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  deadAirCount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  eyeContactPct?: number | null;
}

export class SummaryQaItemDto {
  @IsString()
  @MaxLength(1000)
  question!: string;

  @IsString()
  @MaxLength(15000)
  answerTranscript!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  score?: number;
}

export class SummaryAnalyzeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  deckName!: string;

  @IsOptional()
  @IsIn(AUDIENCES)
  audience?: (typeof AUDIENCES)[number];

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  questionCount?: number;

  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SummarySlideItemDto)
  slides!: SummarySlideItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SummaryQaItemDto)
  qaResults?: SummaryQaItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SummaryTimelineEventDto)
  timelineEvents?: SummaryTimelineEventDto[];
}

export class TtsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;
}
