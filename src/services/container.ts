import type { AppConfig } from '../config.js';
import { ContextRepository } from '../repositories/contextRepository.js';
import { ExampleRepository } from '../repositories/exampleRepository.js';
import { ContextService } from './contextService.js';
import { ExampleService } from './exampleService.js';
import { ReviewService } from './reviewService.js';

export interface Services {
  config: AppConfig;
  context: ContextService;
  examples: ExampleService;
  review: ReviewService;
}

export function createServices(config: AppConfig): Services {
  const contextRepo = new ContextRepository(config);
  const exampleRepo = new ExampleRepository(config.examplesDir, config.limits.maxFileBytes);
  return {
    config,
    context: new ContextService(contextRepo, config),
    examples: new ExampleService(contextRepo, exampleRepo, config),
    review: new ReviewService(contextRepo, exampleRepo),
  };
}
